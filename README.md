# Kaila

Kaila is a standalone FastAPI/Jinja2 styling application for turning screen-inspired aesthetics into budget-aware outfit ideas. It includes an interactive style quiz, text-led screen-style references, a curated clothing/accessory inspiration catalogue, retailer search links for Canada and the United States, YouCam virtual try-on, YouCam Skin Analysis, separate facial colour-tone analysis, fragrance discovery based on explicit scent preferences, and a browser-local wardrobe.

## Product behaviour

- **Not an image-scraper.** Screen/celebrity style references are original descriptions and outbound editorial searches. Kaila does not scrape the style sites in the reference list or reuse show stills/celebrity portraits.
- **Not an inventory feed.** Catalogue cards are labelled *Style inspiration*. Retail links are labelled *Retail search*. Kaila does not invent current product prices, SKUs, stock, shades, or exact product matches.
- **Local mode works without an account.** Profile, saved references, photos and wardrobe records are stored in IndexedDB in the current browser. They do not sync to another browser/device. Clear local data from Settings. An optional real OpenID Connect (OIDC) sign-in flow is included for installations with an identity provider; no fake login or demo credentials are included. OIDC sign-in alone does not add cross-device profile sync.
- **Provider credentials are server-side.** YouCam and Gemini integrations stay optional. Core catalogue matching and shopping search work without either key. The app does not show secret values in the UI.
- **Photo consent is action-specific.** Choosing a photo only stores it locally for possible reuse. An image is transmitted to YouCam only after the user checks the relevant consent and starts the matching operation. VTO photos and the two analysis workflows are kept separate in the browser.
- **Skin Analysis is not diagnosis.** Results are displayed only from normalized provider-returned data. They may be affected by lighting, makeup and camera quality. Retail links are general cosmetic discovery, not claims of treatment.
- **Colour-tone analysis is separate.** It reports detected colour values for optional styling guidance. It does not diagnose skin conditions or determine which colours someone should wear.
- **Fragrance is preference-led.** Search links depend on user-selected scent families, never on skin scores or a selfie.

## Run locally

Requires Python 3.11 or newer.

```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env           # optional for local use; set keys to enable provider features
uvicorn index:app --reload
```

Open <http://127.0.0.1:8000>. New local profiles start at the Style Quiz. After saving preferences, the app opens Ensemble. The project intentionally does not include a scripted demo or presentation assets.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | Production | Signs the browser session used for CSRF protection. Generate a unique, high-entropy value. |
| `OIDC_DISCOVERY_URL` | Optional | Identity provider's OpenID Connect discovery URL (typically ends in `/.well-known/openid-configuration`). |
| `OIDC_CLIENT_ID` | Optional | Client ID issued by the identity provider. |
| `OIDC_CLIENT_SECRET` | Optional | Client secret issued by the identity provider. |
| `AUTH_REQUIRED` | Optional | Set to `1` to require configured OIDC sign-in before accessing the app and protected API routes. |
| `YCE_API_KEY` | For YouCam features | YouCam API key. Never put it in browser JavaScript. |
| `YCE_API_BASE` | No | Defaults to `https://yce-api-01.makeupar.com`. |
| `GEMINI_API_KEY` | Optional | Enables bounded fashion-language interpretation. |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-3.6-flash`; change to a model available to your Google AI project. |

If the YouCam key is missing, virtual try-on, Skin Analysis and colour-tone analysis return a helpful unavailable message, while discovery, the quiz, wardrobe and retail search remain usable. If Gemini is missing or fails, Kaila falls back to deterministic catalogue matching. If OIDC variables are configured, `/login` starts a real provider sign-in flow; `AUTH_REQUIRED=1` enables enforcement. Set the OIDC callback URL in your identity provider to `https://YOUR_HOST/auth/callback`.

## YouCam features

The current integration uses the Perfect Corp/YouCam file API at `/s2s/v2.0/file`, the AI Clothes V4 task at `/s2s/v2.0/task/cloth-v4`, Skin Analysis V2.1 at `/s2s/v2.1/task/skin-analysis`, and the facial colour-tone task at `/s2s/v2.0/task/skin-tone-analysis`. Tasks are polled at the matching task-status endpoint. The provider schema and API entitlement can change; verify account-specific requirements against the current official documentation before public deployment.

- [YouCam AI Clothes VTO integration guide](https://docs.perfectcorp.com/reference/ai_clothes/section/overview/integration-guide)
- [YouCam AI Cloth V4 task reference](https://docs.perfectcorp.com/reference/ai_clothes/v4.0/paths/~1s2s~1v2.0~1task~1cloth-v4/post)
- [YouCam Skin Analysis V2.1](https://docs.perfectcorp.com/reference/ai_skin_analysis/v2.1)
- [YouCam developer quick start](https://docs.perfectcorp.com/develop/quick_start_guide)

## Celebrity-style editorial sources

Discover links to StarStyle, Star Style Man, The Budget Babe's Celebrity Style category, CelebMafia, and Steal Her Style. These are outbound references only. Kaila does not scrape their content or copy and redistribute celebrity photos.

All user images are validated as actual JPG/JPEG/PNG content, resized to the supported maximum side where necessary, and sent only after consent. Server-side uploaded photo bytes and raw provider payloads are not written to disk or logs. YouCam may retain/process submitted images under its own terms; the UI asks for consent before every operation.

## App structure

```text
kaila/
├── index.py
├── kaila/
│   ├── config.py
│   ├── main.py
│   ├── catalog.py
│   ├── screen_style.py
│   ├── recommender.py
│   └── services/
│       ├── gemini.py
│       └── youcam.py
├── templates/
│   ├── landing.html
│   ├── login.html
│   └── app.html
├── public/assets/
│   ├── app.js
│   ├── site-settings.js
│   └── style.css
├── tests/
├── requirements.txt
├── .env.example
└── vercel.json
```

## Tests

```bash
python -m pytest -q
```

Tests cover basic route health, page rendering, API-key redaction, CSRF protection, recommendation boundaries and budget-specific search links, image validation, and graceful handling when YouCam is not configured. The real provider path also needs a smoke test using a key and units from your YouCam account.

## Deployment notes

1. Create the repository named `kaila` and push this source tree.
2. Import the repository into Vercel and add `SESSION_SECRET` (required for a production deployment), and the YouCam/Gemini keys if you want those features enabled.
3. Confirm Vercel serves `/assets/*` and forwards application requests to `index.py`. The config routes public assets directly from `public/assets` and includes the root `templates/` directory in the function bundle.
4. Test the deployed landing page, quiz submit, `/health`, recommendation request, consent failure, missing-key behaviour and image polling before sharing it.
5. Review privacy notice, provider terms, source-image permissions and your intended authentication model before collecting personal data in production.

## Scope boundaries

Kaila does not scrape fashion sites, process checkout, claim affiliate status, or label inspiration images as verified products. It does not diagnose medical conditions, recommend treatment based on a skin score, or infer fragrance preferences from images. No cross-device account sync is included. Demo and presentation preparation are out of scope.
