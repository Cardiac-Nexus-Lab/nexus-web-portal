"""Cardiac Nexus Email Service
Provides secure email delivery for user registration verification and notifications.
Supports standard SMTP servers (Gmail, SendGrid, Amazon SES, Outlook, Mailgun, custom SMTP).
All configurations are securely loaded from environment variables.
"""

import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Tuple, Optional


def get_smtp_config() -> dict:
    """Load SMTP settings from environment variables."""
    return {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "587").strip() or "587"),
        "user": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", "").strip(),
        "from_email": os.getenv("SMTP_FROM_EMAIL", "").strip() or os.getenv("SMTP_USER", "").strip(),
        "from_name": os.getenv("SMTP_FROM_NAME", "Cardiac Nexus Security").strip(),
        "use_tls": os.getenv("SMTP_USE_TLS", "True").strip().lower() in ("true", "1", "yes"),
        "use_ssl": os.getenv("SMTP_USE_SSL", "False").strip().lower() in ("true", "1", "yes"),
        "frontend_url": os.getenv("FRONTEND_URL", "http://localhost:5173").strip().rstrip("/"),
    }


def is_smtp_configured() -> bool:
    """Returns True if minimum required SMTP settings (host, user, password) are set."""
    cfg = get_smtp_config()
    return bool(cfg["host"] and cfg["user"] and cfg["password"])


def test_smtp_connection() -> Tuple[bool, str]:
    """Test connecting and authenticating with the configured SMTP server."""
    cfg = get_smtp_config()
    if not cfg["host"]:
        return False, "SMTP_HOST is not configured in backend/.env"
    if not cfg["user"] or not cfg["password"]:
        return False, "SMTP_USER or SMTP_PASSWORD is not configured in backend/.env"

    try:
        if cfg["use_ssl"] or cfg["port"] == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=context, timeout=10) as server:
                server.login(cfg["user"], cfg["password"])
                return True, f"Successfully connected and authenticated with {cfg['host']}:{cfg['port']} via SSL."
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=10) as server:
                server.ehlo()
                if cfg["use_tls"]:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                    server.ehlo()
                server.login(cfg["user"], cfg["password"])
                return True, f"Successfully connected and authenticated with {cfg['host']}:{cfg['port']} via TLS."
    except smtplib.SMTPAuthenticationError as e:
        return False, f"SMTP Authentication failed: {e.smtp_error.decode() if isinstance(e.smtp_error, bytes) else str(e)}"
    except smtplib.SMTPConnectError as e:
        return False, f"Failed to connect to SMTP server {cfg['host']}:{cfg['port']}: {str(e)}"
    except Exception as e:
        return False, f"SMTP connection error: {str(e)}"


def build_verification_email_html(
    name: str,
    email: str,
    otp_code: str,
    verification_link: str,
    expires_in_minutes: int = 15
) -> str:
    """Constructs a responsive, high-security HTML email for Cardiac Nexus email verification."""
    display_name = name.strip() if name and name.strip() else "Healthcare Researcher"
    
    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Cardiac Nexus Account</title>
  <style>
    body {{
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f1f5f9;
      color: #1e293b;
    }}
    .email-container {{
      max-width: 580px;
      margin: 30px auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      border: 1px solid #e2e8f0;
    }}
    .header {{
      background: linear-gradient(135deg, #091a2b 0%, #0d2847 100%);
      padding: 32px 28px;
      text-align: center;
      border-bottom: 3px solid #0284c7;
    }}
    .header h1 {{
      margin: 0;
      color: #ffffff;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }}
    .header p {{
      margin: 6px 0 0;
      color: #93c5fd;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      font-weight: 600;
    }}
    .content {{
      padding: 36px 32px;
    }}
    .greeting {{
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 12px;
    }}
    .lead-text {{
      font-size: 15px;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 24px;
    }}
    .otp-card {{
      background: #f8fafc;
      border: 2px dashed #0284c7;
      border-radius: 10px;
      padding: 24px;
      text-align: center;
      margin: 24px 0;
    }}
    .otp-label {{
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #0369a1;
      margin-bottom: 8px;
    }}
    .otp-code {{
      font-family: 'Courier New', Courier, monospace;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #0284c7;
      padding: 8px 16px;
      display: inline-block;
      user-select: all;
    }}
    .otp-expiry {{
      font-size: 12px;
      color: #64748b;
      margin-top: 8px;
    }}
    .button-container {{
      text-align: center;
      margin: 30px 0 20px;
    }}
    .action-button {{
      background: #0284c7;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      display: inline-block;
      letter-spacing: 0.3px;
    }}
    .security-notice {{
      background: #fffbeb;
      border-left: 4px solid #f59e0b;
      padding: 14px 18px;
      border-radius: 4px;
      font-size: 13px;
      line-height: 1.5;
      color: #92400e;
      margin: 24px 0 10px;
    }}
    .footer {{
      background: #f8fafc;
      padding: 24px 32px;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      line-height: 1.6;
    }}
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>Cardiac Nexus</h1>
      <p>Cognitive Multimodal Deep Learning Platform</p>
    </div>
    
    <div class="content">
      <div class="greeting">Hello, {display_name}</div>
      <p class="lead-text">
        Thank you for initiating registration on Cardiac Nexus. To ensure the security of clinical research data and verify that you own <strong>{email}</strong>, please complete verification below.
      </p>

      <div class="otp-card">
        <div class="otp-label">Your 6-Digit Verification Code</div>
        <div class="otp-code">{otp_code}</div>
        <div class="otp-expiry">Valid for {expires_in_minutes} minutes &bull; One-time use</div>
      </div>

      <div class="button-container">
        <a href="{verification_link}" class="action-button" target="_blank">Verify Email Instantly</a>
      </div>

      <div class="security-notice">
        <strong>Security Notice:</strong> If you did not register for Cardiac Nexus or suspect someone entered your email by mistake, please disregard this email. Your email address will remain unverified, and no access will be granted.
      </div>
    </div>

    <div class="footer">
      This is an automated system notification from Cardiac Nexus AI Platform.<br>
      For security reasons, do not forward or share this code with anyone.
    </div>
  </div>
</body>
</html>
"""
    return html


def build_verification_email_text(
    name: str,
    email: str,
    otp_code: str,
    verification_link: str,
    expires_in_minutes: int = 15
) -> str:
    """Constructs a plain-text fallback verification email."""
    display_name = name.strip() if name and name.strip() else "Healthcare Researcher"
    return f"""CARDIAC NEXUS - REGISTRATION EMAIL VERIFICATION

Hello {display_name},

Thank you for registering on Cardiac Nexus. To verify that you own {email} and activate your account, please use the following one-time verification code:

Verification Code: {otp_code}
(This code is valid for {expires_in_minutes} minutes)

Alternatively, you can verify your account directly by visiting this secure link:
{verification_link}

SECURITY NOTICE:
If you did not register for Cardiac Nexus, someone may have entered your email address by mistake. Please ignore this email. No account will be activated without this verification step.

--
Cardiac Nexus AI Research Platform
Security & Identity Verification System
"""


def send_verification_email(
    to_email: str,
    name: str,
    otp_code: str,
    token: str
) -> Tuple[bool, str]:
    """
    Sends a verification email with OTP and direct verification link to the recipient.
    Returns (success: bool, detail_message: str).
    Guarantees no false positive 'success' response: returns False if sending fails.
    """
    cfg = get_smtp_config()
    if not is_smtp_configured():
        return False, "SMTP is not fully configured (missing SMTP_HOST, SMTP_USER, or SMTP_PASSWORD in backend/.env)."

    to_email_clean = to_email.lower().strip()
    verification_link = f"{cfg['frontend_url']}/?verify_token={token}&email={to_email_clean}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{otp_code} is your Cardiac Nexus verification code"
    msg["From"] = f"{cfg['from_name']} <{cfg['from_email']}>"
    msg["To"] = to_email_clean
    msg["Reply-To"] = cfg["from_email"]

    text_part = MIMEText(build_verification_email_text(name, to_email_clean, otp_code, verification_link), "plain", "utf-8")
    html_part = MIMEText(build_verification_email_html(name, to_email_clean, otp_code, verification_link), "html", "utf-8")

    msg.attach(text_part)
    msg.attach(html_part)

    try:
        if cfg["use_ssl"] or cfg["port"] == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=context, timeout=12) as server:
                server.login(cfg["user"], cfg["password"])
                server.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=12) as server:
                server.ehlo()
                if cfg["use_tls"]:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                    server.ehlo()
                server.login(cfg["user"], cfg["password"])
                server.send_message(msg)

        return True, f"Verification email successfully delivered to {to_email_clean} via SMTP ({cfg['host']})."

    except smtplib.SMTPAuthenticationError as e:
        err = e.smtp_error.decode() if isinstance(e.smtp_error, bytes) else str(e)
        return False, f"SMTP Authentication failed: {err}. Please verify your SMTP credentials."
    except smtplib.SMTPRecipientsRefused:
        return False, f"The recipient email address {to_email_clean} was rejected by the mail server."
    except smtplib.SMTPSenderRefused:
        return False, f"The sender address {cfg['from_email']} was refused by the mail server."
    except smtplib.SMTPException as e:
        return False, f"SMTP protocol error while sending to {to_email_clean}: {str(e)}"
    except Exception as e:
        return False, f"Unexpected error delivering email to {to_email_clean}: {str(e)}"
