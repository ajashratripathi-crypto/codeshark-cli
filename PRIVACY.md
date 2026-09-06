# CodeShark Privacy Notice

*Last updated: September 5, 2026*

This notice describes how CodeShark handles information when you use the CLI,
the CodeShark website, or the CodeShark community gateway.

## The CLI

CodeShark does not include analytics or telemetry by default. The CLI reads and
writes files in the project directory you select, and it may execute commands
there after you approve them. Local configuration can contain provider API keys.
Protect your computer and configuration file; do not place secrets in prompts
or project files that you send to an AI provider.

## AI requests

When you use the shared gateway, your prompts, selected tool definitions, and
relevant conversation or file content are sent to the gateway and then to one
or more upstream providers selected by the gateway, including OpenRouter,
Google, or
other providers selected by that service. When you use your own provider key,
requests go to the provider configured by you.

AI providers may process, retain, or log requests under their own policies and
terms. CodeShark cannot guarantee that prompts, generated output, IP addresses,
or provider-side request metadata are never retained. Review the applicable
provider documentation before sending confidential, personal, regulated, or
proprietary information.

## Gateway data

The community gateway receives request data and network information needed to
route requests, enforce rate limits, prevent abuse, and operate the service.
The gateway implementation does not intentionally log prompt contents, but
Cloudflare and upstream providers may process operational metadata according to
their own policies. The gateway uses in-memory rate-limit state and does not
promise a particular retention period.

## API keys

Keys entered into the CLI are stored locally in the CodeShark configuration
file. On POSIX systems CodeShark attempts to set restrictive file permissions.
On Windows, filesystem permissions depend on the account and machine settings;
users should protect the configuration file and computer themselves. Keys sent
to the shared gateway are held as server-side deployment secrets and are not
returned to clients.

## Your choices

You can use a local Ollama provider to keep model requests on your machine, or
configure your own provider directly. You can remove local configuration by
deleting the path shown by your configuration setup. You can avoid the shared
gateway by selecting another provider.

## Website

The static website does not intentionally collect form submissions or use
analytics. External resources, including Google Fonts and npm links, may
receive normal browser request metadata under their own policies.

## Children and regulated data

CodeShark is not designed for children or for handling health, payment,
financial, educational, employment, export-controlled, or other regulated data.
Do not send such information unless you have confirmed that the selected
provider and your legal obligations permit it.

## Changes and contact

This notice may change as the service changes. For questions or privacy
requests, open an issue in the CodeShark repository listed in `package.json`.
This notice is informational and is not legal advice.
