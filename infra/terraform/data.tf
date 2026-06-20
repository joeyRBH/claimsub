# Account / region context, resolved from the caller's credentials at apply time.
# Using these instead of hardcoded values keeps the account ID out of the repo.
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

# Two AZs for the private subnets (RDS Multi-AZ-ready, Lambda HA).
data "aws_availability_zones" "available" {
  state = "available"
}
