# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Store customers (consumers, CPF):** people with a broken or new phone who browse parts and accessories, build a cart and send the order to the store on WhatsApp.
- **Retailers (lojistas, CNPJ):** phone repair shops buying parts at the retailer price.
- **Store owner and sellers (admin):** the owner (Nathan) and up to a few sellers per store, working at the counter on a laptop. They ring up walk-in sales, open and close the daily cash register, answer site orders and back-in-stock requests, and check monthly profit.

## Product Purpose

Top Smart sells phone parts and accessories (screens, batteries, films, cases, chargers, components) from physical stores. The site is the online catalog plus the store's back office: site orders arrive in the admin with notifications, and counter sales, the daily cash register and sales reports replace the GestãoClick screens the owner uses today. Success means the owner can run a whole day (open register, sell at the counter, close register, send the closing summary to the "Caixa" WhatsApp group) without leaving the admin.

## Operating Context

- Each store has one cash register per day, opened by the owner in the morning and closed at night. All sellers of that store share it; each sale records which seller made it.
- Counter sale flow today (GestãoClick): search product by name or code, price auto-filled and editable, add items, pick a registered customer or "Ao consumidor", choose payment, generate a receipt ("notinha"), screenshot it and send it to the customer on WhatsApp to pay by Pix.
- Every receipt and the daily closing are posted in a WhatsApp group ("Caixa ENG"). Closing message seen: "FECHAMENTO TOPENG 09/10 / Fundo caixa / Vendas / Pix / Dinheiro".
- The register view shows opening float in cash, counter sales per payment method, payments taken out of the register, and the real balance. A register once stayed open for days by mistake; the product should make that visible.
- Sales report: quantity, cost, revenue and profit per product, filtered by day, week or month, printed or saved as PDF at closing.

## Capabilities and Constraints

- Plain HTML/CSS/JS, no build step, deployed on Vercel with serverless functions in `api/` and Upstash Redis for shared data.
- Payment methods at the counter: Dinheiro, Pix, Cartão de crédito, Cartão de débito, Pós-pago (fiado, money to receive), split across methods, and Devolução de mercadoria (refund that returns stock).
- Counter sales, registers, products, stock (with a movement log), supplier purchases and expenses are stored on the server (`api/catalogo.js`, `api/pdv.js`, `api/financeiro.js`). The public catalog never exposes cost. Customer accounts of the site still live in the browser.
- A catalog created before the move is sent once from the admin's browser (Produtos shows the button while the server is empty).
- Counter search suggests products only from 4 typed letters.
- Admin access is a server-checked login with a 12-hour signed session.

## Brand Commitments

- Name "Top Smart", tagline "Aqui tem inovação!", logo on black. Colors from the logo: black, white, blue (#2F80C8 sampled, #1C6CB5 for text-on-blue contrast).
- Language: Brazilian Portuguese, informal and direct, the owner's own vocabulary (caixa, fundo de caixa, sangria, fiado, notinha, lojista).

## Evidence on Hand

- Logo: `assets/logo.png` (cropped from a screenshot, dark background only).
- Store photos from the owner's video: `assets/loja-*.jpg`.
- Reference videos in `Material/nathan/` (store tour, supplier catalog, GestãoClick register, reports and counter sale).
- No real product catalog, costs, testimonials or store address yet. Do not fabricate them.

## Product Principles

1. The counter comes first: a sale must be faster than in GestãoClick, keyboard friendly, on a laptop.
2. Money must always add up: every total on screen can be traced to sales, refunds and register movements.
3. Show mistakes early: an unclosed register, a sold-out item in a cart, a missing seller are surfaced before they cost money.
4. Everything ends in WhatsApp: receipts and closings are produced ready to send.

## Accessibility & Inclusion

WCAG AA contrast, visible focus, full keyboard use in the admin.
