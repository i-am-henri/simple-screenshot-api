import { createId } from "@paralleldrive/cuid2";
import { Hono } from "hono";
import puppeteer from "puppeteer-extra";
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { z } from "zod";
import { PuppeteerBlocker } from '@cliqz/adblocker-puppeteer';
import fetch from 'cross-fetch';
import fs from 'fs';
import path from 'path';

// Initialize puppeteer with stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Create output directory if it doesn't exist
const SCREENSHOTS_DIR = './screenshots';
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export default (app: Hono<any>) => {
  const screenshotSchema = z.object({
    url: z.string().url(),
    width: z.number().int().min(320).max(3840).default(1280),
    height: z.number().int().min(240).max(2160).default(800),
    waitTime: z.number().int().min(0).max(10000).default(1000),
    fullPage: z.boolean().default(false),
    handleCookieBanners: z.boolean().default(true)
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  app.post("/screenshot", async (c) => {
    let browser = null;
    try {
      // Parse and validate input
      const parseBody = await c.req.parseBody();
      const validationResult = await screenshotSchema.safeParseAsync({
        url: parseBody.url,
        width: parseBody.width ? +parseBody.width : undefined,
        height: parseBody.height ? +parseBody.height : undefined,
        waitTime: parseBody.waitTime ? +parseBody.waitTime : undefined,
        fullPage: parseBody.fullPage === 'true' || (parseBody.fullPage as any) === true,
        handleCookieBanners: parseBody.handleCookieBanners !== 'false' && (parseBody.handleCookieBanners as any) !== false
      });

      if (!validationResult.success) {
        return c.json({ 
          success: false, 
          error: validationResult.error.errors[0].message 
        }, 400);
      }

      const { url, width, height, waitTime, fullPage, handleCookieBanners } = validationResult.data;
      
      // Launch browser with improved settings
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=' + width + ',' + height
        ]
      });

      // Create new page with proper viewport
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      
      // Set reasonable timeouts
      await page.setDefaultNavigationTimeout(30000);
      await page.setDefaultTimeout(30000);
      
      // Enable ad blocking
      const blocker = await PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch);
      await blocker.enableBlockingInPage(page);

      // Navigate to the page
      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      if (!response) {
        throw new Error('Failed to load the page');
      }

      if (!response.ok()) {
        throw new Error(`Page error: ${response.status()} ${response.statusText()}`);
      }

      // Wait for page to be fully loaded
      await page.evaluate(() => new Promise(resolve => {
        if (document.readyState === 'complete') {
          resolve(true);
        } else {
          window.addEventListener('load', () => resolve(true));
        }
      }));

      // Give the page a moment to settle
      await sleep(1000);

      // Handle cookie banners if enabled
      if (handleCookieBanners) {
        await handleCookieConsent(page);
      }

      // Wait additional time after handling cookie banners
      await sleep(waitTime);
      
      // Generate unique ID for the screenshot
      const id = createId();
      const filePath = path.join(SCREENSHOTS_DIR, `${id}.png`);
      
      // Take the screenshot
      await page.screenshot({
        path: filePath,
        fullPage: fullPage
      });

      // Close the browser
      await browser.close();
      browser = null;

      // Return success response
      return c.json({ 
        success: true, 
        id,
        path: filePath
      });

    } catch (error) {
      console.error('Screenshot error:', error);
      // Make sure browser is closed in case of error
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error('Error closing browser:', closeError);
        }
      }
      
      return c.json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      }, 500);
    }
  });
};

// Separated cookie consent handling function
async function handleCookieConsent(page: any): Promise<void> {
  try {
    // First, check for and handle specific cookie consent solutions
    await page.evaluate(() => {
      // Common consent terms in multiple languages
      const consentTerms = {
        accept: ['accept', 'accept all', 'accepter', 'accepta', 'acepto', 'akzeptieren', 'accetta', 'aceitar', 'принять', 'принимаю', 'akceptuję'],
        agree: ['agree', 'i agree', 'согласен', 'согласиться', 'zgadzam się', 'agree to all', 'zustimmen', 'ich stimme zu', 'j\'accepte', 'estoy de acuerdo'],
        allow: ['allow', 'allow all', 'zulassen', 'toestaan', 'permitir', 'разрешить', 'consenti', 'autoriser', 'zezwalaj'],
        consent: ['consent', 'give consent', 'ich willige ein', 'consentir', 'согласие', 'autorizzare', 'autorizo'],
        ok: ['ok', 'okay', 'ok, i agree', 'так', 'ок', 'd\'accord'],
        gotIt: ['got it', 'ich habe verstanden', 'entendido', 'понятно', 'je comprends', 'capito', 'rozumiem'],
        close: ['close', 'cerrar', 'schliessen', 'fechar', 'закрыть', 'fermer', 'chiudi', 'zamknij'],
        confirm: ['confirm', 'confirmar', 'bestätigen', 'подтвердить', 'confirmer', 'confermare', 'potwierdzać']
      };

      // Function to check if button text matches any consent term
      function matchesConsentTerm(text: string): boolean {
        text = text.toLowerCase().trim();
        // Check if text contains any of the consent terms in any language
        return Object.values(consentTerms).some(terms => 
          terms.some(term => text.includes(term.toLowerCase()))
        );
      }

      // Helper function to safely click an element
      function safeClick(element: HTMLElement | null) {
        if (!element) return false;
        try {
          element.click();
          return true;
        } catch (e) {
          return false;
        }
      }

      // 1. Handle CookieBot specifically
      if ((window as any).CookieConsent || document.getElementById('CybotCookiebotDialog')) {
        // Try to find and click "Accept" button on Cookiebot
        const cookiebotButtons = document.querySelectorAll('#CybotCookiebotDialogBodyLevelButtonAccept, #CybotCookiebotDialogBodyButtonAccept');
        cookiebotButtons.forEach(button => {
          safeClick(button as HTMLElement);
        });
      }

      // 2. OneTrust cookie consent
      if (document.getElementById('onetrust-banner-sdk')) {
        const onetrustAcceptBtn = document.querySelector('#onetrust-accept-btn-handler') as HTMLElement;
        if (safeClick(onetrustAcceptBtn)) return;
      }

      // 3. Common cookie notice patterns - look for specific buttons first
      const acceptButtonSelectors = [
        // Buttons with specific accept text
        'button[aria-label*="accept" i], button[aria-label*="agree" i], button[aria-label*="cookie" i]',
        'button:not([aria-hidden="true"]):not([style*="display: none"]):not([style*="visibility: hidden"])',
        'a.accept, a.allow, a.agree'
      ];

      // Try these specific selectors first
      for (const selector of acceptButtonSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = (el.textContent || '').toLowerCase();
          if (matchesConsentTerm(text)) {
            safeClick(el as HTMLElement);
          }
        });
      }

      // 4. Generic cookie banner removal as a last resort
      const cookieBannerSelectors = [
        // Common cookie banner IDs/classes
        '[id*="cookie-banner" i]', '[class*="cookie-banner" i]',
        '[id*="cookie-consent" i]', '[class*="cookie-consent" i]',
        '[id*="cookie-notice" i]', '[class*="cookie-notice" i]',
        '[id*="gdpr" i]', '[class*="gdpr" i]',
        '.cc-window', '.cc-banner',
        // IDs for common solutions
        '#CybotCookiebotDialog', '#onetrust-banner-sdk',
        '#cookiebanner', '#cookie-law-info-bar'
      ];

      // Only remove banners if we couldn't click accept buttons
      document.querySelectorAll(cookieBannerSelectors.join(', ')).forEach(el => {
        try { el.remove(); } catch (e) { /* ignore */ }
      });
    });

    // Additional check for iframes that might contain cookie banners
    const frames = await page.frames();
    for (const frame of frames) {
      try {
        await frame.evaluate(() => {
          // Common consent terms in multiple languages (duplicated for frame context)
          const consentTerms = {
            accept: ['accept', 'accept all', 'accepter', 'accepta', 'acepto', 'akzeptieren', 'accetta', 'aceitar', 'принять', 'принимаю', 'akceptuję'],
            agree: ['agree', 'i agree', 'согласен', 'согласиться', 'zgadzam się', 'agree to all', 'zustimmen', 'ich stimme zu', 'j\'accepte', 'estoy de acuerdo'],
            allow: ['allow', 'allow all', 'zulassen', 'toestaan', 'permitir', 'разрешить', 'consenti', 'autoriser', 'zezwalaj']
          };

          // Check if text matches any consent term
          function matchesConsentTerm(text: string): boolean {
            text = text.toLowerCase().trim();
            return Object.values(consentTerms).some(terms => 
              terms.some(term => text.includes(term.toLowerCase()))
            );
          }

          const acceptButtons = document.querySelectorAll('button, a');
          acceptButtons.forEach(button => {
            const text = (button.textContent || '').toLowerCase();
            if (matchesConsentTerm(text)) {
              try {
                (button as HTMLElement).click();
              } catch (e) { /* ignore */ }
            }
          });
        });
      } catch (e) {
        // Ignore frame access errors
      }
    }
  } catch (error) {
    console.error('Error handling cookie consent:', error);
    // Don't throw, just log - we want to continue taking the screenshot
  }
}