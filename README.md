# Paternoster

Encrypted messages disguised as prayers, political slogans, profanity, or emoji.

**[paternoster.pimenov.cc](https://paternoster.pimenov.cc)**

## Why

Encrypted data looks encrypted. On a platform where that draws attention, you need the output to look like something else entirely.

Paternoster encrypts your message (X25519, AES-256-GCM), compresses it, and encodes the result as themed text. Pick your camouflage: Orthodox prayers, Trump rally chants, drunk Russian swearing, Latin liturgy, CJK characters, or emoji. Nine themes from the solemn to the obscene — all roundtrip perfectly.

The whole thing ships as one HTML file. No server, no accounts, no dependencies. Download it, put it on a USB stick, send it over IPFS.

## Themes

**БОЖЕ** Church Slavonic · **РОССИЯ** patriotic slogans · **СССР** Soviet agitprop · **БУХАЮ** drunk profanity · **TRUMP** MAGA rally · **PATER** Latin ecclesiastical · **КИТАЙ** CJK ideographs · **🙂** emoji · **hex** plain hexadecimal

## Build & develop

```
npm install
npm run build        # → dist/index.html, the whole app
npm run dev          # Vite dev server
npm test             # Vitest
npm run test:e2e     # Playwright
```

Crypto, steganography, compression, and UX decisions are in [`docs/`](docs/).

## Authors

[Kirill Pimenov](https://github.com/kirushik) · [Leonid Kaganov](https://github.com/lleokaganov) ([lleo.me](https://lleo.me))

## License

[MIT](LICENSE)
