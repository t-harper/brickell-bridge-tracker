env           = "prod"
aws_region    = "us-east-1"
floci         = false
cors_origin   = "*"
bridge_domain = "bridge.travis-harper.net"

apns_team_id   = "NBZC7TH45V"
apns_key_id    = "245Y298G7X"
apns_bundle_id = "net.travis-harper.bridgetracker"
# apns_p8_pem is sensitive and passed via TF_VAR_apns_p8_pem
# (GitHub secret APNS_KEY_P8 for CI; export locally before terraform apply).
