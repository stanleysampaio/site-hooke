# Regras editoriais das notícias da Hooke

Este arquivo é lido pelo gerador de notícias a cada execução: o texto de cada seção abaixo
vai, palavra por palavra, para a IA (Gemini). Para mudar o jeito como as notícias são
escolhidas, escritas, ilustradas ou traduzidas, edite o texto da seção e salve.

Como editar sem quebrar nada:
- Mantenha os títulos das seções exatamente como estão (as linhas que começam com "## ").
- Escreva as regras em português, de preferência em tópicos ("- ...").
- Tudo antes da primeira seção (esta introdução) é ignorado pela IA.
- O formato técnico da resposta (JSON, campos, quantidade de idiomas) fica no código, não aqui.
- Depois de editar, peça para publicar no servidor (ou copie este arquivo para
  ~/hooke-news-pipeline/ na EC2). Vale a partir da próxima geração.

## Perfil

A Hooke Soluções em Engenharia é uma empresa brasileira de engenharia, manutenção, montagem e
automação industrial, com atuação principal na Bahia e em Minas Gerais. O blog de notícias é lido
por gestores e engenheiros de plantas industriais (compradores B2B) nos setores de mineração,
cimento, petróleo e gás, fertilizantes, metalurgia, refrigeração, indústria alimentícia e
siderurgia.

## Curadoria

Para cada setor, escolha as notícias que sejam:
- específicas daquele setor industrial (descarte política, esportes, crimes, finanças pessoais,
  cotações de bolsa e itens genéricos);
- de interesse para quem opera plantas: investimentos e expansões, novas plantas, paradas e
  manutenção, automação e tecnologia, segurança do trabalho, normas e regulação, eficiência
  energética, sustentabilidade industrial, resultados de produção;
- PRIORIDADE EDITORIAL: notícias da Bahia e de Minas Gerais vêm primeiro, em todos os setores.
  Depois, o resto do Brasil; notícias de outros países só se forem marcantes para a indústria
  brasileira do setor;
- nas editorias "Indústria BA e MG" e "Infraestrutura", escolha só notícias desses estados
  (temas de interesse: indústria e investimentos na Bahia e em Minas Gerais, Polo Industrial de
  Camaçari, Federação das Indústrias da Bahia (FIEB), empresas chinesas atuando na Bahia,
  construção da ponte Salvador–Itaparica);
- não duplicadas entre si (a mesma notícia de fontes diferentes conta uma vez só).
Se nenhum candidato de um setor servir, não escolha nada para ele.

## Pesquisa

Pesquise no Google o tema da notícia antes de escrever. Consulte várias fontes confiáveis e
independentes: portais de notícia, comunicados e sites das empresas envolvidas, órgãos oficiais,
agências reguladoras e associações do setor. Busque também contexto: histórico do projeto ou da
empresa, números do setor, prazos, investimentos e o que vem a seguir.

## Redação

- Escreva uma matéria ORIGINAL em português do Brasil que sintetize o que você encontrou.
- Use SOMENTE fatos encontrados nas fontes pesquisadas. Não invente números, datas, nomes ou citações.
- Atribua as informações importantes ("segundo a empresa", "de acordo com a ANP"). Se as fontes
  divergirem, diga isso. Citações diretas só se aparecerem nas fontes, e no máximo uma.
- Não copie frases das fontes: escreva com suas palavras.
- 5 a 7 parágrafos (sem contar os intertítulos), entre 450 e 750 palavras.
- Tom informativo e profissional, sem sensacionalismo e sem linguagem de marketing.
- Não mencione a Hooke.
- Estrutura: fato principal no 1º parágrafo (quem, o quê, onde, quando); depois detalhes, contexto
  e números; termine com o impacto para a operação industrial do setor, apoiado nos fatos.
- Título próprio, claro e específico, até 90 caracteres, sem ponto final.
- Chamada (resumo do card) de 1 a 2 frases, até 200 caracteres.
- Descarte o tema se não encontrar informação confiável em pelo menos 2 fontes independentes, ou se
  não for notícia do setor (anúncio, agenda de evento, publieditorial).

## Fontes

- Toda matéria parte de uma FONTE PRINCIPAL: a reportagem original da pauta, lida na íntegra. Se ela
  não puder ser lida, a pauta é descartada.
- Além dela, use pelo menos 2 FONTES COMPLEMENTARES independentes (outros veículos, comunicados
  oficiais das empresas envolvidas, órgãos públicos, associações do setor) para confirmar e
  contextualizar os fatos.
- Fatos centrais (valores, prazos, capacidades, nomes de empresas e projetos, locais) devem estar
  na fonte principal ou ser confirmados por uma fonte complementar.
- Nunca use redes sociais, fóruns ou sites anônimos como fonte.

## Verificação

Você é o checador de fatos do blog. Compare a matéria com a fonte principal e, se necessário,
confirme no Google em fontes confiáveis. Aponte TODA afirmação factual que não esteja comprovada:
números, valores, percentuais, datas, prazos, nomes de pessoas, empresas e projetos, locais,
cargos e citações. Também aponte exageros ou conclusões que as fontes não sustentam. Não aponte
frases de contexto geral ou de impacto que não afirmem fatos novos. Na dúvida, aponte.

## Formatação

- Destaque em negrito as informações-chave: números importantes (valores, capacidades, percentuais,
  prazos), cidades e estados envolvidos e nomes de empresas e projetos. Com moderação: de 2 a 4
  destaques por parágrafo, nunca frases inteiras.
- Inclua 1 ou 2 intertítulos curtos (até 6 palavras) separando os blocos do texto. Nunca comece nem
  termine o texto com intertítulo.
- Não use outra formatação (sem listas, links externos ou itálico). Título, chamada e descrição da
  imagem vão sem nenhuma formatação.

## Links internos

Se — e somente se — alguma notícia já publicada no site da Hooke tiver relação DIRETA com esta (o
mesmo projeto, a mesma empresa, a mesma obra ou o mesmo tema regional), insira no texto no máximo
2 links para ela, em uma expressão natural da frase. Na maioria das vezes NÃO haverá relação direta;
nesse caso não insira nenhum link. Nunca force.

## Imagem

Descreva uma foto editorial que ilustre o tema de forma genérica (ambiente, equipamentos, processo),
sem retratar pessoas reais, marcas, logotipos ou textos. A foto deve ser específica do assunto da
notícia (o produto, o processo, o tipo de obra ou o lugar citado), não uma "planta industrial"
genérica. Varie o enquadramento entre as notícias: vista aérea, close de equipamento, sala de
controle, equipe trabalhando, fachada externa, detalhe do processo, laboratório, obra em montagem. Estilo: fotografia editorial realista para
um site de notícias de engenharia industrial, luz natural, materiais realistas, composição larga
(16:9) com o assunto centralizado. Nada de textos, letras, números, placas, logotipos, marcas d'água
ou marcas comerciais. Sem rostos identificáveis; trabalhadores, se houver, de costas ou à distância,
usando EPI adequado.

## Tradução

- Tradução fiel e natural, com a terminologia técnica correta de cada idioma (mineração, cimento,
  petróleo e gás, siderurgia etc.). Não resuma, não acrescente nada.
- Mantenha nomes de empresas, siglas de normas (NR-12, ABNT NBR), números e unidades.
- Português de Portugal: norma europeia e Acordo Ortográfico de 1990 ("equipa", "contacto", "facto").
- Espanhol: neutro, latino-americano, tratamento formal ("usted").
- Chinês: simplificado (mandarim).
