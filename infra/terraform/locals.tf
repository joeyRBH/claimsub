locals {
  prefix = "${var.project_name}-${var.environment}"

  # SSM namespace for this stack's parameters. The Lambda execution role is
  # scoped to exactly this path (see iam.tf).
  ssm_path_prefix = "/${var.project_name}/${var.environment}"

  # Two private subnets, one per AZ (first two AZs in the region).
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  # The auth surface: one Lambda per handler, each its own API Gateway route.
  # `handler` matches backend/handlers/<name>.handler (the zip root is /backend).
  lambda_functions = {
    register = { handler = "handlers/register.handler", method = "POST", path = "register" }
    login    = { handler = "handlers/login.handler", method = "POST", path = "login" }
    me       = { handler = "handlers/me.handler", method = "GET", path = "me" }
  }

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "claimsub-backend"
    HIPAA       = "true"
  }
}
