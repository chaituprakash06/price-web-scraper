// scraper.js
import puppeteer from 'puppeteer';
import Groq from "groq-sdk";
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

// Initialize Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Function to upsert product data to Supabase
async function upsertProduct(product) {
    try {
        const { data, error } = await supabase
            .from('products')
            .upsert(
                {
                    id: product.id,
                    name: product.name,
                    volume_ml: product.volume_ml,
                    current_price: product.current_price,
                    price_per_100ml: product.price_per_100ml,
                    best_deal: product.best_deal,
                    updated_at: new Date().toISOString()
                },
                {
                    onConflict: 'id',  // Update if product ID already exists
                    returning: true     // Return the updated/inserted record
                }
            );

        if (error) throw error;
        console.log(`Upserted product: ${product.name}`);
        return data;
    } catch (error) {
        console.error('Error upserting product:', error);
        return null;
    }
}

async function scrapeLiquorland() {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox']
        });
        
        const page = await browser.newPage();
        await page.goto('https://www.liquorland.com.au/offers?page=3', {
            waitUntil: 'domcontentloaded'
        });

        // Extract specific pricing elements
        const products = await page.evaluate(() => {
            const tiles = document.querySelectorAll('.ProductTileV2');
            return Array.from(tiles).map(tile => {
                // Extract volume from product name
                const nameElement = tile.querySelector('.product-name');
                const name = nameElement?.textContent.trim() || '';
                const volumeMatch = name.match(/(\d+)\s*m[Ll]/);
                const volume_ml = volumeMatch ? parseInt(volumeMatch[1]) : null;

                // Get base price
                const priceElement = tile.querySelector('.PriceTag.zero-cents.current.primary .dollarAmount');
                const current_price = priceElement ? parseFloat(priceElement.textContent) : null;

                // Calculate price per 100ml
                const price_per_100ml = volume_ml && current_price 
                    ? (current_price / volume_ml) * 100 
                    : null;

                // Get promotional information
                const best_deal = {
                    type: null,
                    details: null
                };

                // Check for multi-buy offers
                const multiBuyElement = tile.querySelector('.dinkus.clickable-view-all');
                if (multiBuyElement) {
                    best_deal.type = 'multi-buy';
                    best_deal.details = multiBuyElement.textContent.trim();
                }

                // Check for price drops
                const wasPriceElement = tile.querySelector('.PriceTag.zero-cents.slashthrough.secondary');
                if (wasPriceElement) {
                    best_deal.type = 'price-drop';
                    best_deal.details = wasPriceElement.textContent.trim();
                }

                return {
                    id: tile.getAttribute('data-product-id'),
                    name: tile.querySelector('.product-brand')?.textContent.trim() + ' ' + name,
                    volume_ml,
                    current_price,
                    price_per_100ml,
                    best_deal
                };
            }).filter(product => 
                product.id && 
                product.name && 
                product.volume_ml && 
                product.current_price
            );
        });

        // Process products through Groq for analysis
        const systemPrompt = `Analyze these products and rank them by value, considering:
        1. Base price per 100ml
        2. Any promotional offers
        3. Pack sizes and bulk discounts
        Return a ranked list from best value to least.`;

        // Process in batches
        for (const product of products) {
            // Upsert each product to Supabase
            await upsertProduct(product);
        }

        // Let's still do the Groq analysis for immediate feedback
        const analysis = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(products, null, 2) }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 32768
        });
        
        console.log('\nGroq Analysis:');
        console.log(analysis.choices[0]?.message?.content || "No analysis received");

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeLiquorland();