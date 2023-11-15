import { PythonLayerVersion } from "@aws-cdk/aws-lambda-python-alpha";
import { Duration, aws_ec2, aws_lambda, aws_logs } from "aws-cdk-lib";
import { AwsCustomResource } from "aws-cdk-lib/custom-resources";
import { TriggerFunction } from "aws-cdk-lib/triggers";
import { Construct } from "constructs";


export interface DBInitializerProps {
    readonly vpc: aws_ec2.Vpc;
    readonly dbConfigSecret: string;
}

export class DBInitializer extends Construct {
    constructor(scope: Construct, id: string, props: DBInitializerProps) {
        super(scope, id);

        const initializerSg = new aws_ec2.SecurityGroup(this, 'initializer-sg', {
            vpc: props.vpc,
            allowAllOutbound: true
        })

        const mysqlLayer = new PythonLayerVersion(this, 'mysql-layer', {
            entry: './lib/layers/mysql',
            compatibleRuntimes: [aws_lambda.Runtime.PYTHON_3_11]
        })

        const initializerFn = new TriggerFunction(this, 'initializer-fn', {
            runtime: aws_lambda.Runtime.PYTHON_3_11,
            vpc: props.vpc,
            handler: 'runscript.lambda_handler',
            code: aws_lambda.Code.fromAsset('./lib/functions/initializer'),
            environment: {
                "DB_CONFIG_SECRET": props.dbConfigSecret,
            },
            securityGroups: [
                initializerSg
            ],
            layers: [mysqlLayer],
            tracing: aws_lambda.Tracing.ACTIVE,
            timeout: Duration.minutes(15),
            description: 'DB Initializer',
            logRetention: aws_logs.RetentionDays.ONE_MONTH
        });                 

        this.function = initializerFn
        this.fnSecurityGroup = initializerSg          
    }

    readonly function: TriggerFunction
    readonly fnSecurityGroup: aws_ec2.SecurityGroup
}