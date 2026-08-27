# Security Policy

This project processes player relationship data, game demos, browser sessions,
and biometric voice embeddings. Please handle reports and reproductions with
particular care.

## Reporting a vulnerability privately

Do **not** open a public issue or upload real player data. Use GitHub's
**Report a vulnerability** button on the repository's Security tab (private
vulnerability reporting) once the repository is published. If that channel is
not enabled, contact the maintainer through the private contact method on their
GitHub profile and request a secure reporting channel before sending details.

Include the affected version or commit, impact, minimal reproduction using
synthetic data, and any suggested mitigation. Remove tokens, webhook URLs,
cookies, demos, voices, usernames, and database contents from logs and captures.

You should receive an acknowledgement within 7 days and a status update within
14 days. Please allow time for a fix and coordinated disclosure.

## Supported versions

Until tagged releases exist, only the latest revision of the default branch is
supported. Rotate any credential that may have been exposed; deleting it from a
working tree is not sufficient once it has entered Git history.
