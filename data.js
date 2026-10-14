// Dados de exemplo do esboço. Na versão final vêm do banco (Prisma) e do painel admin.
window.STORE = {
  name: "Top Smart",
  whatsapp: "5533999414255", // número da fachada da loja; confirmar com o cliente
  categories: [
    { slug: "telas", name: "Telas", icon: "c-telas", desc: "Displays e frontais" },
    { slug: "peliculas", name: "Películas", icon: "c-peliculas", desc: "Vidro, 3D, privacidade" },
    { slug: "capinhas", name: "Capinhas", icon: "c-capinhas", desc: "Silicone, anti-impacto" },
    { slug: "baterias", name: "Baterias", icon: "c-baterias", desc: "Alta durabilidade" },
    { slug: "carregadores", name: "Carregadores", icon: "c-carregadores", desc: "Cabos e fontes" },
    { slug: "acessorios", name: "Acessórios", icon: "c-acessorios", desc: "Fones e mais" },
    { slug: "tampas", name: "Tampas", icon: "c-tampas", desc: "Tampas traseiras e aros" },
    { slug: "pecas", name: "Componentes", icon: "c-pecas", desc: "Conector, flex, lentes" },
  ],
  brands: {
    Apple: ["iPhone 11", "iPhone 11 Pro Max", "iPhone 12", "iPhone 13", "iPhone 14", "iPhone 15"],
    Samsung: ["Galaxy A14", "Galaxy A34", "Galaxy A54", "Galaxy S23"],
    Motorola: ["Moto G23", "Moto G54", "Moto G84", "Edge 40"],
    Xiaomi: ["Redmi Note 12", "Redmi Note 13", "Poco X5", "Redmi 13C"],
    Infinix: ["Hot 30", "Hot 40", "Smart 8"],
  },
};

(() => {
  const P = (id, name, cat, brand, models, price, stock, extra = {}) => ({
    id, slug: id, name, cat, brand, models, price, stock,
    promo: extra.promo || null,
    featured: !!extra.featured,
    isNew: !!extra.isNew,
    variants: extra.variants || null,
    sku: "TS-" + String(1000 + Number(id.split("-").pop() || 0)),
  });
  let n = 0;
  const id = (s) => `${s}-${++n}`;
  window.STORE.products = [
    P(id("tela-iphone-11"), "Tela iPhone 11", "telas", "Apple", ["iPhone 11"], 189, 12, { featured: true, variants: [["Incell", 0], ["OLED", 60], ["Original retirada", 160]] }),
    P(id("tela-iphone-11-pro-max"), "Tela iPhone 11 Pro Max", "telas", "Apple", ["iPhone 11 Pro Max"], 249, 4, { variants: [["Incell", 0], ["OLED", 80]] }),
    P(id("tela-iphone-13"), "Tela iPhone 13", "telas", "Apple", ["iPhone 13"], 390, 6, { featured: true, variants: [["Incell", 0], ["OLED", 60]] }),
    P(id("tela-galaxy-a54"), "Tela Galaxy A54 com aro", "telas", "Samsung", ["Galaxy A54"], 320, 3, { isNew: true, variants: [["Incell", 0], ["OLED original", 140]] }),
    P(id("tela-galaxy-a14"), "Tela Galaxy A14", "telas", "Samsung", ["Galaxy A14"], 129, 0),
    P(id("tela-moto-g54"), "Tela Moto G54", "telas", "Motorola", ["Moto G54"], 165, 8, { isNew: true }),
    P(id("tela-redmi-note-12"), "Tela Redmi Note 12", "telas", "Xiaomi", ["Redmi Note 12"], 210, 5, { variants: [["Incell", 0], ["OLED", 70]] }),
    P(id("tela-infinix-hot-30"), "Tela Infinix Hot 30", "telas", "Infinix", ["Hot 30"], 95, 9),
    P(id("pelicula-3d-iphone"), "Película 3D iPhone 13/14", "peliculas", "Apple", ["iPhone 13", "iPhone 14"], 25, 80, { featured: true, promo: 19.9 }),
    P(id("pelicula-privacidade-iphone"), "Película privacidade iPhone 15", "peliculas", "Apple", ["iPhone 15"], 39.9, 40, { isNew: true }),
    P(id("pelicula-3d-a54"), "Película 3D Galaxy A54", "peliculas", "Samsung", ["Galaxy A54"], 25, 60),
    P(id("pelicula-hidrogel"), "Película hidrogel (corte na hora)", "peliculas", "Motorola", ["Moto G23", "Moto G54", "Moto G84", "Edge 40"], 35, 200),
    P(id("pelicula-camera"), "Película de câmera Redmi Note 13", "peliculas", "Xiaomi", ["Redmi Note 13"], 15, 30),
    P(id("capinha-silicone-iphone"), "Capinha silicone aveludada iPhone 13", "capinhas", "Apple", ["iPhone 13"], 49.9, 25, { featured: true, variants: [["Preta", 0], ["Azul", 0], ["Branca", 0]] }),
    P(id("capinha-anti-impacto-a34"), "Capinha anti-impacto Galaxy A34", "capinhas", "Samsung", ["Galaxy A34"], 39.9, 18, { variants: [["Transparente", 0], ["Preta", 0]] }),
    P(id("capinha-carteira-g84"), "Capinha carteira Moto G84", "capinhas", "Motorola", ["Moto G84"], 59.9, 2),
    P(id("bateria-iphone-11"), "Bateria iPhone 11", "baterias", "Apple", ["iPhone 11"], 119, 10, { featured: true }),
    P(id("bateria-a14"), "Bateria Galaxy A14", "baterias", "Samsung", ["Galaxy A14"], 89, 7),
    P(id("bateria-poco-x5"), "Bateria Poco X5", "baterias", "Xiaomi", ["Poco X5"], 99, 0),
    P(id("fonte-20w-usbc"), "Fonte 20W USB-C", "carregadores", "Apple", ["iPhone 12", "iPhone 13", "iPhone 14", "iPhone 15"], 79.9, 30, { featured: true, promo: 64.9 }),
    P(id("cabo-usbc-lightning"), "Cabo USB-C para Lightning 1m", "carregadores", "Apple", ["iPhone 11", "iPhone 12", "iPhone 13", "iPhone 14"], 39.9, 50),
    P(id("carregador-turbo-25w"), "Carregador turbo 25W Samsung", "carregadores", "Samsung", ["Galaxy A34", "Galaxy A54", "Galaxy S23"], 89.9, 15, { isNew: true }),
    P(id("fone-bluetooth"), "Fone Bluetooth com estojo", "acessorios", "Xiaomi", ["Redmi Note 12", "Redmi Note 13", "Poco X5"], 129, 12, { isNew: true, featured: true }),
    P(id("suporte-veicular"), "Suporte veicular magnético", "acessorios", "Motorola", ["Moto G23", "Moto G54", "Moto G84"], 45, 20),
    P(id("conector-carga-a14"), "Conector de carga Galaxy A14", "pecas", "Samsung", ["Galaxy A14"], 35, 14),
    P(id("tampa-traseira-iphone-12"), "Tampa traseira iPhone 12", "tampas", "Apple", ["iPhone 12"], 85, 3, { variants: [["Preta", 0], ["Branca", 0], ["Azul", 0]] }),
    P(id("lente-camera-g84"), "Lente de câmera Moto G84", "pecas", "Motorola", ["Moto G84"], 22, 11),
    P(id("flex-power-hot-40"), "Flex power/volume Infinix Hot 40", "pecas", "Infinix", ["Hot 40"], 28, 6, { isNew: true }),
    P(id("tampa-traseira-galaxy-a54"), "Tampa traseira Galaxy A54", "tampas", "Samsung", ["Galaxy A54"], 69, 5, { isNew: true, variants: [["Preta", 0], ["Lilás", 0], ["Verde", 0]] }),
    P(id("tampa-traseira-redmi-note-12"), "Tampa traseira Redmi Note 12", "tampas", "Xiaomi", ["Redmi Note 12"], 55, 4, { variants: [["Cinza", 0], ["Azul", 0]] }),
    P(id("tampa-traseira-moto-g84"), "Tampa traseira Moto G84", "tampas", "Motorola", ["Moto G84"], 59, 0),
  ];
})();
