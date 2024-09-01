import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
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

    // Ensure this is the only pipeline with this name
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
        // Add more stages like Deploy here
      ],
      artifactBucket: artifactBucket,
    });
  }
}
