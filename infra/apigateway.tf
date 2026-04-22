resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name_prefix}-api-${var.env}"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = [var.cors_origin]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["content-type"]
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_status" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /api/bridges/brickell"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "get_status_alt" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /api/bridges/brickell/status"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "get_history" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /api/bridges/brickell/history"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "get_stats" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /api/bridges/brickell/stats"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "post_device" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /api/devices"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "delete_device" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "DELETE /api/devices/{deviceId}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "post_activity" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /api/devices/{deviceId}/activity"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "delete_activity" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "DELETE /api/devices/{deviceId}/activity/{activityId}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /api/health"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "allow_apigw" {
  statement_id  = "AllowAPIGWInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.bucket
}

output "history_bucket" {
  value = aws_s3_bucket.history.bucket
}

output "current_table" {
  value = aws_dynamodb_table.current.name
}

output "poller_function" {
  value = aws_lambda_function.poller.function_name
}
