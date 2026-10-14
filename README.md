# Top Smart: esboço do site catálogo

Protótipo navegável do site catálogo da Top Smart. Feito em HTML, CSS e JS puros, sem etapa de build.

Inclui home, catálogo com filtros (categoria, marca e modelo do aparelho, preço, estoque), página de produto com variações, carrinho (drawer e página), envio do pedido pelo WhatsApp, login e cadastro, área do cliente e um painel admin básico.

No site publicado, produtos, estoque, vendas do balcão, caixa, compras de fornecedor e despesas ficam no servidor (Upstash Redis), iguais em qualquer aparelho. Carrinho e contas de cliente do site ainda ficam no `localStorage`. Abrindo o `index.html` direto, o site usa o catálogo de exemplo do `data.js`.

- Cadastro em duas modalidades na tela de login: cliente (CPF, nome, nascimento, telefone, e-mail) e lojista (CNPJ, razão social, responsável, telefone, e-mail). CPF e CNPJ são validados.
- Painel admin (`#/admin`): cadastro de produto com foto, nome, quantidade e preço de venda, além de pedidos e lista de cadastros.
- Produtos cadastrados no painel ficam salvos só no navegador de quem cadastrou. Para valer para todos os visitantes, é preciso o backend da versão final.
- Número do WhatsApp da loja: `data.js` (`whatsapp`)
- Produtos de exemplo: `data.js`

Para rodar localmente, abra o `index.html` no navegador.

## Painel do admin

- **Caixa:** um por dia e por loja. Mostra Pix, dinheiro e cartão, quem abriu e quem fechou (com horário), os produtos que saíram e voltaram no dia, e imprime o fechamento.
- **Venda balcão:** a busca sugere produtos a partir de 4 letras. Venda, troca, devolução e cancelamento mexem no estoque do servidor.
- **Estoque:** posição com valor a custo e a venda, estoque mínimo, produtos parados, histórico de movimentações e ajuste por contagem.
- **Entrada de estoque:** soma o que chegou do fornecedor e atualiza o custo. O pagamento ao fornecedor é lançado depois em Despesas.
- **Despesas:** contas a pagar, recorrentes (a do mês seguinte é criada ao pagar) e pagas com o dinheiro do caixa (viram retirada).
- **Dashboard:** DRE gerencial, lucro líquido, ponto de equilíbrio, fluxo de caixa, contas a pagar e a receber (fiado), estoque (giro, cobertura, curva ABC, dinheiro parado), produtos, vendedores e controle de caixa.
- **Primeira vez no servidor:** em Produtos aparece o botão "Enviar catálogo", que copia uma única vez os produtos deste navegador (com fotos, custo e estoque).

## Aviso de pedido no WhatsApp do dono

Quando um pedido chega pelo site, o servidor (`api/orders.js`) manda o pedido completo no WhatsApp do dono, mesmo com o painel fechado. Sai uma mensagem quando o pedido é gerado e outra quando o cliente confirma entrega e pagamento. Se o envio falhar, o pedido é salvo normalmente e o erro aparece nos logs da Vercel. O código fica em `api/_whatsapp.js`.

Variáveis de ambiente na Vercel:

- `WHATSAPP_TO`: número do dono com DDI e DDD, só dígitos (ex.: `5533999999999`). Para mais de um número, separe por vírgula. Sem essa variável, os pedidos vão para o número da loja, (19) 97828-3417 (`5519978283417`).
- `WHATSAPP_PROVIDER`: `callmebot` (padrão, grátis) ou `zapi`.
- `CALLMEBOT_APIKEY`: chave do CallMeBot. Para mais de um número, uma chave por número, na mesma ordem.
- `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`: dados da instância, se usar a Z-API.
- `SITE_URL` (opcional): endereço do site para o link "Ver pedido".

Para ativar o CallMeBot, salve o número +34 611 04 87 48 (confira o número atual em callmebot.com) nos contatos do celular do dono e mande para ele, pelo WhatsApp, a mensagem `I allow callmebot to send me messages`. A resposta traz a apikey.

Para testar, com o admin logado: `POST /api/whatsapp-test` manda um pedido de exemplo.
