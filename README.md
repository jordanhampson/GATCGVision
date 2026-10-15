# Archive Table

Webcam table for Grand Archive with automatic card recognition.

How a card is recognized: the card is isolated from the mat (grayscale, Gaussian blur, threshold, external contours, four-corner filter by area and aspect ratio), its perspective is corrected with OpenCV, and perceptual hashes (DCT pHash) of the art, the cost corner and the element corner are matched to the library by Hamming distance.

## Put it on GitHub Pages
1. Create a repository and upload everything in this folder, including `index.html`, `algo.js`, `worker.js`, the `tools` folder and the hidden `.github` folder (if the web uploader skips it, create `.github/workflows/library.yml` with Add file > Create new file).
2. Settings > Pages > Deploy from branch > `main`, folder `/ (root)`.
3. Actions > **Build card library** > Run workflow. It downloads the card art once, writes `library/library.json` and `library/library.bin` into the repo, and re-runs weekly to pick up new cards.
4. Open the Pages URL. The page loads the finished library in a second or two. Nothing is built in the browser.

If you are upgrading from an earlier version, run **Build card library** again: the library format changed (now about 64 bytes per card) and old files are rejected.

## Or build the library on your own computer
```
npm install
node tools/build-library.mjs
python3 -m http.server 8000
```
Then open http://localhost:8000. Commit the `library/` folder if you want to host it.

If the build reports image errors for every card, the image server is refusing your network. Tell the developer.
