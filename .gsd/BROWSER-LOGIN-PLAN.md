# Browser and login implementation

1. Add a local browser connection service with default-context CDP attachment, saved endpoint, installed Chrome/Edge setup and disconnect ownership rules.
2. Add separate session/Windows-DPAPI credential storage, redacted settings APIs and dashboard forms.
3. Integrate one-attempt login handling before seat selection and during checkout, retaining manual CAPTCHA/OTP/payment handoffs.
4. Verify build, unit/API tests, real CDP browser fixtures, dashboard screenshots and smoke. Restart the local bot with the completed build, then commit and push source changes including earlier authorized smoke/seat fixes.
