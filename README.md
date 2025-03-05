# Simple Screenshot Api

Welcome to this small API that allows you to take screenshots of websites. It blocks cookie banners and uses a custom puppeteer configuration to avoid detection. It's made by [Henri](https://henri.is).

## Usage

First install bun, after that clone the repository and install the dependencies:

```bash
git clone https://github.com/i-am-henri/simple-screenshot-api.git
cd screenshot-api
bun install
```

Then, start the server:

```bash
bun dev
```

You can now send an post request to `http://localhost:3000/screenshot` with the following body:

```json
{
  "url": "https://example.com",
  "width": 1280,
  "height": 800,
  "waitTime": 1000,
}

```

The response will be a JSON object with the following structure:

```json
{
  "success": true,
  "id": "1234567890",
  "path": "..."
}
```

