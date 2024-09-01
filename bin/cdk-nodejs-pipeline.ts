#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkNodejsPipelineStack } from '../lib/cdk-nodejs-pipeline-stack';

const app = new cdk.App();
new CdkNodejsPipelineStack(app, 'CdkNodejsPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '597088049679',
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-2',
  },
});
