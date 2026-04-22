resource "aws_cloudwatch_event_rule" "poll_schedule" {
  name                = "${local.name_prefix}-poll-${var.env}"
  schedule_expression = var.poll_schedule_expression
}

resource "aws_cloudwatch_event_target" "poll_target" {
  rule = aws_cloudwatch_event_rule.poll_schedule.name
  arn  = aws_lambda_function.poller.arn
}

resource "aws_lambda_permission" "allow_events" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.poller.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.poll_schedule.arn
}
