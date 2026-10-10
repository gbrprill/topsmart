# Top Smart: esboço do site catálogo

Protótipo navegável do site catálogo da Top Smart. Feito em HTML, CSS e JS puros, sem etapa de build.

Inclui home, catálogo com filtros (categoria, marca e modelo do aparelho, preço, estoque), página de produto com variações, carrinho (drawer e página), envio do pedido pelo WhatsApp, login e cadastro, área do cliente e um painel admin básico.

Tudo roda no navegador. Carrinho, usuários e pedidos ficam no `localStorage`. A versão final segue o briefing: Next.js, Prisma, PostgreSQL e Auth.js.

- Cadastro em duas modalidades na tela de login: cliente (CPF, nome, nascimento, telefone, e-mail) e lojista (CNPJ, razão social, responsável, telefone, e-mail). CPF e CNPJ são validados.
- Painel admin (`#/admin`): cadastro de produto com foto, nome, quantidade e preço de venda, além de pedidos e lista de cadastros.
- Produtos cadastrados no painel ficam salvos só no navegador de quem cadastrou. Para valer para todos os visitantes, é preciso o backend da versão final.
- Número do WhatsApp da loja: `data.js` (`whatsapp`)
- Produtos de exemplo: `data.js`

Para rodar localmente, abra o `index.html` no navegador.
