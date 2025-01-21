import puppeteer from 'puppeteer';

async function scrapeLiquorland() {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
        });
        
        const page = await browser.newPage();
        
        console.log('Navigating to page...');
        await page.goto('https://www.liquorland.com.au/offers?page=3', {
            waitUntil: 'domcontentloaded'
        });

        // Use Promise.all to wait for multiple conditions
        await Promise.all([
            page.waitForSelector('.ProductTileV2'),
            page.waitForSelector('.product-brand'),
            page.waitForSelector('.dollarAmount')
        ]);

        // Extract product information
        const products = await page.evaluate(() => {
            const productElements = document.querySelectorAll('.ProductTileV2');
            
            return Array.from(productElements, element => {
                try {
                    // Get the brand and name
                    const brand = element.querySelector('.product-brand')?.textContent.trim() || '';
                    const name = element.querySelector('.product-name')?.textContent.trim() || '';
                    
                    // Get the price (handle both dollar and cents parts)
                    const dollars = element.querySelector('.dollarAmount')?.textContent.trim() || '0';
                    const cents = element.querySelector('.centsAmount')?.textContent.trim() || '00';
                    const price = parseFloat(`${dollars}.${cents}`);

                    // Extract volume from the name
                    const volumeMatch = name.match(/(\d+)\s*m[Ll]/);
                    const volumeML = volumeMatch ? parseInt(volumeMatch[1]) : null;

                    if (!volumeML || !price) {
                        console.log(`Skipping product due to missing volume or price: ${brand} ${name}`);
                        return null;
                    }

                    return {
                        brand,
                        name,
                        price,
                        volumeML,
                        pricePer100ml: (price / volumeML) * 100
                    };
                } catch (error) {
                    console.log('Error processing product:', error);
                    return null;
                }
            }).filter(product => product !== null);
        });

        // Sort and display results
        if (products.length === 0) {
            console.log('No products found.');
            return;
        }

        const sortedProducts = products.sort((a, b) => a.pricePer100ml - b.pricePer100ml);
        
        console.log('\nBest Deals (Sorted by Price per 100mL):');
        console.log('----------------------------------------');
        sortedProducts.forEach((product, index) => {
            console.log(`${index + 1}. ${product.brand} - ${product.name}`);
            console.log(`   Price: $${product.price.toFixed(2)}`);
            console.log(`   Volume: ${product.volumeML}mL`);
            console.log(`   Price per 100mL: $${product.pricePer100ml.toFixed(2)}`);
            console.log('----------------------------------------');
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

scrapeLiquorland();