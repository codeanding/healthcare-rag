output "bucket_name" {
  value = aws_s3_bucket.docs.id
}

output "bucket_arn" {
  value = aws_s3_bucket.docs.arn
}
