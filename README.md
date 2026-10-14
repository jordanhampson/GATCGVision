# Archive Table

Webcam table for Grand Archive with automatic card recognition and champion life tracking.

## Put it on GitHub Pages
1. Create a repository and upload everything in this folder, including the hidden `.github` folder and the `tools` folder.
2. Settings > Pages > Deploy from branch > `main`, folder `/ (root)`.
3. Actions > **Build card library** > Run workflow. It downloads the card art once, writes `library/library.json` and `library/library.bin` into the repo, and re-runs weekly to pick up new cards.
4. Open the Pages URL. The page loads the finished library in a second or two. Nothing is built in the browser.

## Or build the library on your own computer
```
npm install
node tools/build-library.mjs
python3 -m http.server 8000
```
Then open http://localhost:8000. Commit the `library/` folder if you want to host it.

If the build reports image errors for every card, the image server is refusing your network. Tell the developer.
