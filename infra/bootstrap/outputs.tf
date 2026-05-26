output "bucket_name" {
  description = "Drop this into the backend block of every environment."
  value       = aws_s3_bucket.state.id
}

output "region" {
  description = "Region of the state bucket."
  value       = var.region
}

output "backend_block_snippet" {
  description = "Copy-paste-ready backend block for environments."
  value       = <<-EOT
    backend "s3" {
      bucket       = "${aws_s3_bucket.state.id}"
      key          = "<env>/terraform.tfstate"
      region       = "${var.region}"
      profile      = "${var.profile}"
      encrypt      = true
      use_lockfile = true
    }
  EOT
}
