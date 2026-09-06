# CodeShark Terms of Service

*Last updated: September 5, 2026*

By installing, downloading, or using CodeShark (the "Software"), you agree to
these Terms of Service. If you do not agree, do not use the Software.

## 1. What CodeShark is

CodeShark is an open-source terminal coding agent. It can read, create, and
edit files, run searches, and execute commands **inside the current directory or
the project folder selected with `--folder` or `--cwd`**. The selected path must
be a directory, not an individual file. It is a tool you operate — you are
responsible for choosing when and how it acts.

## 2. No warranty

The Software and the shared gateway service are provided **"AS IS" and "AS
AVAILABLE"**, without warranty of any kind, express or implied, including
merchantability, fitness for a particular purpose, and non-infringement. Model
responses may be incorrect, incomplete, or harmful; verify all output before
relying on it. The shared gateway is a free, best-effort service — uptime,
speed, and model availability are not guaranteed.

## 3. Fair use of the shared gateway

When you use the shared gateway (the default "zero setup" path), requests are
routed through shared free-tier provider lanes. You agree to:

- **Not** resell, redistribute, or grant access to the gateway to third parties.
- **Not** scrape, stress-test, or otherwise abuse the gateway or its providers.
- **Not** use the Software for unlawful purposes, spam, or generating harmful
  content.
- Accept that rate limits and queues apply to keep the service usable by
  everyone. Requests may be delayed, queued, or refused to protect the shared
  free tier.

## 4. Your content

You retain rights you already hold in the prompts you enter and the files you
edit. Rights in generated content depend on applicable law, originality, and
the terms of the selected provider; CodeShark does not guarantee ownership or
exclusivity of generated content. You are solely responsible for your content.
Do not paste passwords, API keys, or other secrets into prompts — they may pass
through third-party providers. Prompts and generated content are not private;
treat them accordingly. See `PRIVACY.md` for more information.

## 5. Limitation of liability

To the maximum extent permitted by law, the authors and maintainers of
CodeShark are **not liable** for any damages arising from use of the Software,
including lost data, lost profits, corrupted files, or harm caused by generated
content or executed commands. You use the Software entirely at your own risk.

## 6. API keys

If you paste your own provider key, CodeShark stores it locally and does not
print it intentionally. CodeShark attempts restrictive permissions on POSIX
systems; on Windows, protection depends on your account and machine settings.
Keys configured on the shared gateway are deployment secrets and are not
returned to clients. Third-party providers may process request data under their
own terms. You are responsible for protecting your own keys.

## 7. Third-party services

CodeShark may connect to third-party services, including model providers,
Cloudflare, Google, and Ollama. Those services have separate terms,
privacy policies, availability limits, model restrictions, and data practices.
You are responsible for complying with the terms that apply to the provider
and model you select. CodeShark does not represent or endorse those providers.

## 8. Updates

The CLI may check npm for a newer CodeShark release at startup and asks for
confirmation before installing it. You can skip the check with
`CODESHARK_NO_UPDATE=1` or run `codeshark update` manually.

## 9. Changes

These Terms may be updated at any time. Continued use of the Software after
changes constitutes acceptance of the revised Terms.

## 10. Termination

We may refuse or terminate access to the shared gateway at any time, with or
without notice, for any reason — including violation of these Terms. The
open-source Software itself remains available under its MIT license.

## 11. Contact

For questions about these Terms, open an issue in the CodeShark repository.