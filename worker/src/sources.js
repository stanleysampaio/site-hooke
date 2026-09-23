// Feeds RSS por setor. Curadoria inicial — validar/ajustar após o primeiro deploy,
// já que a cobertura de portais B2B industriais em PT-BR é desigual entre setores.
// Cada setor tem 2-4 feeds; o worker soma os itens de todos os feeds do setor
// antes de pedir pra IA selecionar os 5 melhores.

export const SOURCES = {
  "Mineração": [
    "https://mineracaobrasil.com/feed/",
    "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  ],
  "Cimento": [
    "https://abcp.org.br/feed/",
    "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  ],
  "Petróleo e Gás": [
    "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  ],
  "Fertilizantes": [
    "https://www.agrolink.com.br/rss/noticias.xml",
    "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  ],
  "Metalurgia": [
    "https://metalurgia.com.br/feed/",
    "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  ],
  "Refrigeração": [
    "https://revistadofrio.com.br/feed/",
    "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  ],
  "Alimentícia": [
    "https://www.foodconnection.com.br/feed/",
    "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  ],
  "Siderurgia": [
    "https://www.acobrasil.org.br/site/feed/",
    "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml",
  ],
};
