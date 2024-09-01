import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SecretValue } from 'aws-cdk-lib';

export class CdkNodejsPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for storing artifacts
    const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      versioned: true,
    });

    // Reference the GitHub token from AWS Secrets Manager
    const githubToken = SecretValue.secretsManager('github-token');

    // Define the source action from GitHub
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'GitHub_Source',
      owner: 'usmankhandk',
      repo: 'nodejs-app',
      branch: 'main',
      oauthToken: githubToken,
      output: sourceOutput,
    });

    // Define the build project
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: ['npm install'],
          },
          build: {
            commands: ['npm run build'],
          },
        },
        artifacts: {
          'base-directory': 'dist',
          files: ['**/*'],
        },
      }),
    });

    const buildOutput = new codepipeline.Artifact();
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Build',
      project: buildProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });

    // Create an IAM Role
    const role = new iam.Role(this, 'MyInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'), // EC2 service will assume this role
    });

    // Attach policies to the role
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess')); // Example: Allow read access to S3

    // Define a VPC with public subnets
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.PUBLIC, // Public subnet
          name: 'PublicSubnet',
        },
        {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Private subnet with NAT
          name: 'PrivateSubnet',
        },
      ],
    });

    // Define a Security Group
    const securityGroup = new ec2.SecurityGroup(this, 'MySecurityGroup', {
      vpc,
      description: 'Allow SSH and HTTP traffic',
      allowAllOutbound: true, // Allow outbound traffic
    });

    // Allow SSH (port 22) from anywhere
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH access from anywhere');

    // Allow HTTP (port 80) from anywhere
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP access from anywhere');

    // Optionally, allow HTTPS (port 443) from anywhere
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS access from anywhere');

    // Define an Auto Scaling Group with public IPs
    const asg = new autoscaling.AutoScalingGroup(this, 'MyAutoScalingGroup', {
      vpc,
      instanceType: new ec2.InstanceType('t2.micro'),
      machineImage: new ec2.AmazonLinuxImage(),
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Ensure instances are in public subnets
      },
      associatePublicIpAddress: true, // Assign public IP addresses
      securityGroup: securityGroup, // Associate the security group
      role: role, // Associate the IAM role
    });

    // Ensure the EC2 instance has the necessary permissions and installs CodeDeploy agent
    asg.addUserData(
      'yum update -y',
      'yum install -y ruby',
      'yum install -y wget',
      'cd /home/ec2-user',
      'wget https://aws-codedeploy-eu-west-2.s3.eu-west-2.amazonaws.com/latest/install',
      'chmod +x ./install',
      './install auto',
      'service codedeploy-agent start',
      'chmod +x /home/ec2-user/myapp/scripts/*.sh'
    );

    // Create a CodeDeploy application
    const codeDeployApp = new codedeploy.ServerApplication(this, 'MyCodeDeployApplication', {
      applicationName: 'MyCodeDeployApp',
    });

    // Create a CodeDeploy deployment group
    const deploymentGroup = new codedeploy.ServerDeploymentGroup(this, 'MyCodeDeployDeploymentGroup', {
      application: codeDeployApp,
      deploymentGroupName: 'MyDeploymentGroup',
      autoScalingGroups: [asg],
      installAgent: true, // Automatically install the CodeDeploy agent
      deploymentConfig: codedeploy.ServerDeploymentConfig.ALL_AT_ONCE, // Deployment strategy
      healthCheck: autoscaling.HealthCheck.ec2(), // Optional: add health checks for the Auto Scaling Group
      autoRollback: {
        failedDeployment: true, // Optional: rollback if the deployment fails
      },
    });

    // Define the deploy action
    const deployAction = new codepipeline_actions.CodeDeployServerDeployAction({
      actionName: 'Deploy',
      input: buildOutput,
      deploymentGroup,
    });

    // Define the pipeline
    new codepipeline.Pipeline(this, 'MyUniquePipeline', {
      pipelineName: 'MyNodejsAppPipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
        {
          stageName: 'Deploy',
          actions: [deployAction],
        },
      ],
      artifactBucket: artifactBucket,
    });
  }
}
