# Bundle Size Testing Instructions

## Testing Bundle Size Reduction

Follow these steps to measure the impact of lazy loading on bundle size.

## Prerequisites

```bash
cd frontend
npm install
```

## Method 1: Vite Build Analysis (Recommended)

### Step 1: Build the application

```bash
npm run build
```

### Step 2: Check the build output

The build command will output a summary like:

```
dist/assets/CredentialImport-abc123.js    25.42 KB │ gzip:  8.12 KB
dist/assets/CredentialShare-def456.js     18.31 KB │ gzip:  6.45 KB
dist/assets/CredentialTimeline-ghi789.js  31.28 KB │ gzip: 10.87 KB
dist/assets/index-main123.js              245.67 KB │ gzip: 82.34 KB
```

### Step 3: Document the sizes

**Before lazy loading** (baseline from git history):
```bash
git stash
git checkout HEAD~1  # Or the commit before lazy loading
npm run build > before-build.txt
```

**After lazy loading** (current):
```bash
git stash pop
npm run build > after-build.txt
```

**Compare**:
```bash
# Compare main bundle sizes
diff before-build.txt after-build.txt
```

## Method 2: Bundle Visualizer

### Install bundle analyzer

```bash
npm install --save-dev rollup-plugin-visualizer
```

### Add to vite.config.ts

```typescript
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    visualizer({
      filename: './dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
});
```

### Build and analyze

```bash
npm run build
# Opens stats.html in browser automatically
```

## Method 3: Manual Inspection

### Check chunk files

```bash
cd dist/assets
ls -lh *.js

# On Windows PowerShell:
Get-ChildItem -Path dist/assets/*.js | Format-Table Name, Length
```

### Look for lazy-loaded chunks

You should see separate chunk files for:
- `CredentialImport-*.js`
- `CredentialShare-*.js`
- `CredentialTimeline-*.js`
- `CredentialComparison-*.js`
- `TemplateEditor-*.js`
- `CredentialRecipientVerify-*.js`

## Method 4: Chrome DevTools Coverage

### Step 1: Start preview server

```bash
npm run build
npm run preview
```

### Step 2: Open DevTools

1. Open application in Chrome
2. Press F12 to open DevTools
3. Press Ctrl+Shift+P (Cmd+Shift+P on Mac)
4. Type "Show Coverage" and press Enter

### Step 3: Measure coverage

1. Click the refresh button in Coverage tab
2. Navigate through the app
3. Check "Unused Bytes" column
4. Should see lower unused bytes on initial load

## Expected Results

### Target Metrics

- **Main bundle reduction**: >100KB (uncompressed)
- **Initial load improvement**: 15-30% faster
- **Lazy chunks created**: 6 separate chunks
- **Coverage improvement**: 10-20% more code used on initial load

### Sample Output

**Before** (no lazy loading):
```
dist/assets/index-main.js    450.32 KB │ gzip: 145.28 KB
```

**After** (with lazy loading):
```
dist/assets/index-main.js              325.18 KB │ gzip: 105.43 KB
dist/assets/CredentialImport.js         28.42 KB │ gzip:   9.12 KB
dist/assets/CredentialShare.js          16.31 KB │ gzip:   5.87 KB
dist/assets/CredentialTimeline.js       32.84 KB │ gzip:  11.23 KB
dist/assets/CredentialComparison.js     22.15 KB │ gzip:   7.94 KB
dist/assets/TemplateEditor.js           38.27 KB │ gzip:  13.15 KB
dist/assets/CredentialRecipientVerify.js 11.45 KB │ gzip:   4.12 KB
```

**Reduction**: 450.32 - 325.18 = **125.14 KB** (39.85 KB gzipped)

## Testing on Slow Connections

### Chrome DevTools Network Throttling

1. Open DevTools (F12)
2. Go to Network tab
3. Click "No throttling" dropdown
4. Select "Slow 3G" or "Fast 3G"

### Test scenarios

1. **Initial load**: Page should load faster
2. **Import modal**: Should show loading fallback briefly
3. **Share modal**: Should show loading fallback briefly
4. **Template editor**: Should show loading fallback briefly

### Expected behavior

- Loading fallback appears for <500ms on Fast 3G
- Loading fallback appears for 1-3s on Slow 3G
- No JavaScript errors in console
- Modals work correctly after load

## Lighthouse Performance Test

### Run Lighthouse

1. Open application in Chrome
2. Open DevTools (F12)
3. Go to Lighthouse tab
4. Select "Performance" category
5. Click "Analyze page load"

### Key metrics to check

- **Performance Score**: Should be >90
- **First Contentful Paint**: <1.5s
- **Largest Contentful Paint**: <2.5s
- **Time to Interactive**: <3.5s
- **Total Blocking Time**: <200ms

## Documenting Results

Create a file `BUNDLE_SIZE_RESULTS.md`:

```markdown
# Bundle Size Reduction Results

## Build Date
2024-XX-XX

## Before Lazy Loading
- Main bundle: XXX KB (XX KB gzipped)
- Total size: XXX KB

## After Lazy Loading
- Main bundle: XXX KB (XX KB gzipped)
- Lazy chunks: XX files totaling XXX KB
- Total size: XXX KB

## Improvement
- Initial bundle reduced by: XXX KB (XX%)
- Gzipped reduction: XX KB (XX%)
- Number of chunks: XX

## Lighthouse Scores
- Performance: XX/100
- First Contentful Paint: X.XXs
- Time to Interactive: X.XXs

## Test Environment
- Node version: vX.X.X
- npm version: X.X.X
- Vite version: X.X.X
- Browser: Chrome XX
```

## Troubleshooting

### Build fails

```bash
# Clear cache and reinstall
rm -rf node_modules dist
npm install
npm run build
```

### Lazy loading not working

1. Check console for errors
2. Verify Suspense boundaries
3. Check network tab for chunk requests
4. Verify import paths are correct

### Chunks not splitting

1. Check vite.config.ts for build.rollupOptions
2. Verify components are using React.lazy()
3. Check that dynamic imports use correct syntax

## Automation Script

Create `scripts/measure-bundle.sh`:

```bash
#!/bin/bash
echo "Building application..."
npm run build

echo -e "\n=== Bundle Sizes ==="
find dist/assets -name "*.js" -exec ls -lh {} \; | awk '{print $9, $5}'

echo -e "\n=== Gzipped Sizes ==="
find dist/assets -name "*.js" -exec gzip -c {} \; | wc -c

echo -e "\n=== Chunk Count ==="
find dist/assets -name "*.js" | wc -l
```

Run with:
```bash
chmod +x scripts/measure-bundle.sh
./scripts/measure-bundle.sh
```
