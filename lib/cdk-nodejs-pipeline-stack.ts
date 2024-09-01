import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as s3 from 'aws-cdk-lib/aws-s3';
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

    // Define a VPC
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 3
    });

    // Define a Security Group for the EC2 instances
    const securityGroup = new ec2.SecurityGroup(this, 'InstanceSecurityGroup', {
      vpc,
      description: 'Allow SSH and HTTP traffic',
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH access');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP access');

    // Define an Auto Scaling Group
    const asg = new autoscaling.AutoScalingGroup(this, 'MyAutoScalingGroup', {
      vpc,
      instanceType: new ec2.InstanceType('t2.micro'),
      machineImage: new ec2.AmazonLinuxImage(),
      securityGroup,
      minCapacity: 1,
      maxCapacity: 2,
      userData: ec2.UserData.forLinux(),
    });

    // Ensure the EC2 instance has the necessary permissions
    asg.addUserData(
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
