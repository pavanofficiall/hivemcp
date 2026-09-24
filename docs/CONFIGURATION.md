# Required external configuration

Hive is running locally at `http://localhost:3000`. Local database, Redis and encryption/session secrets were created in this workspace. Keep existing local values in `.env`.

## 1. GitHub App

Open [GitHub → Settings → Developer settings → GitHub Apps → New GitHub App](https://github.com/settings/apps/new).

Enter:

| Setting                                                    | Value                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GitHub App name                                            | `Hive Local Pavan` (add a unique suffix if GitHub says the name is taken)            |
| Homepage URL                                               | `http://localhost:3000`                                                              |
| Callback URL                                               | `http://localhost:3000/api/github/callback`                                          |
| Request user authorization (OAuth) during installation     | Enabled                                                                              |
| Expire user authorization tokens                           | Enabled; Hive will request reconnection when the GitHub user token expires           |
| Enable Device Flow                                         | Disabled                                                                             |
| Setup URL                                                  | Leave blank when OAuth during installation is enabled                                |
| Webhook Active                                             | Disabled for the first local connection; GitHub cannot deliver directly to localhost |
| Repository permissions → Contents                          | Read-only                                                                            |
| Repository permissions → Metadata                          | Read-only                                                                            |
| All other repository, organization and account permissions | No access                                                                            |
| Where can this GitHub App be installed?                    | Only on this account for a personal proof                                            |

If Orbit's repository belongs to a different organization, create the App under that organization or select “Any account” and install it only on the selected Orbit repository.

After creating the App:

1. Copy **App ID** to `GITHUB_APP_ID`.
2. Copy the App URL's final slug to `GITHUB_APP_SLUG` (the URL resembles `https://github.com/apps/hive-local-pavan`).
3. Copy **Client ID** to `GITHUB_CLIENT_ID`.
4. Under **Client secrets**, generate a client secret and set `GITHUB_CLIENT_SECRET`.
5. Under **Private keys**, generate a private key. Set `GITHUB_APP_PRIVATE_KEY` to the entire PEM, inside double quotes. Literal `\n` between PEM lines is accepted. A real multiline quoted value is also accepted by the current runtime.
6. Start the installation from Hive's **Connect GitHub** button while signed in; install it for **Only select repositories**, selecting the existing Orbit CRM repository. Starting in Hive creates the necessary user-bound state.

The `.env` values to fill are:

```dotenv
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
```

Do not paste credentials into chat. Set them in `/Users/pavan/NexaWorks/hiveMCP/.env` locally. The file is ignored and has owner-only permissions.

### Webhook setup when a reachable URL is available

The implemented local receiver is `http://localhost:3000/api/github/webhook`. To receive real GitHub events, route a user-approved HTTPS development URL to it and enable webhooks with that URL plus `/api/github/webhook`. For an eventual deployment on the requested domain, the exact URL is `https://usehive.tech/api/github/webhook`; it is not deployed by this project.

Use the existing locally generated `GITHUB_WEBHOOK_SECRET` as the GitHub webhook secret. Subscribe to **Push**; GitHub also sends the GitHub App's installation and installation-repositories lifecycle events. Keep Contents and Metadata read-only. No tunnel or public deployment has been created automatically. Manual reanalysis works without webhook delivery.

Reference: [GitHub App installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation), [GitHub setup URLs and installation ownership verification](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).

## 2. Gemini API

Open [Google AI Studio → API keys](https://aistudio.google.com/apikey). Choose **Create API key**, select an existing Google Cloud project or create a dedicated Hive project, and generate a key. Use a project with Gemini API access and sufficient quota. Restrict the key to the Generative Language API when applying API restrictions.

Set:

```dotenv
GEMINI_API_KEY=
GEMINI_ANALYSIS_MODEL=gemini-3.5-flash-lite
```

There are no callback URLs, webhook URLs or OAuth scopes for this API-key connection. This model is configurable. Google model availability can differ by account, so the first live call verifies project access and schema compatibility. If Google retires the configured model, select a current Flash model listed for your API account.

Hive sends bounded, redacted source evidence for semantic inference. Configure the Google project and data-use controls appropriate for that source. No Gemini Spark client key is needed. Reference: [Google's API key setup](https://ai.google.dev/gemini-api/docs/api-key) and [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

## After saving credentials

Restart `npm run dev` and `npm run worker` from this project so both processes load the updated `.env`. Sign into Hive, connect GitHub, select Orbit's repository, and run analysis. No external integration is considered verified until the live calls succeed.

## Later: the existing Orbit application

Orbit's code and OAuth implementation have not been inspected. Do not assume it already has any particular authorization endpoints. Once the real repository is analyzed and the user provides its running environment, configure the actual application's issuer and client registration in Hive → Connections.

The current OAuth adapter expects:

- Issuer-origin `/.well-known/openid-configuration` with authorization, token and userinfo endpoints.
- Authorization Code with PKCE S256.
- A userinfo `sub` identifying the actual application user.
- A bearer access token accepted by the application's existing REST APIs.
- Exact callback: `http://localhost:3000/api/oauth/application/callback`.

If Orbit lacks this infrastructure, request its path and authorization for a narrowly scoped integration change; never create a replacement Orbit app. Application client settings belong in the Hive environment record, not global Orbit admin credentials in `.env`.
