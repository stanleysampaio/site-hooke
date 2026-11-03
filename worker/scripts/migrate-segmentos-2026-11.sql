-- 03/11/2026: as editorias das notícias passam a ser os 5 segmentos da
-- apresentação institucional (mesmos da página Soluções). Backup feito antes
-- com `wrangler d1 export hooke-news --remote`.
--
--   Mineração, Siderurgia, Metalurgia, Cimento -> Mineração e Siderurgia
--   Petróleo e Gás, Fertilizantes             -> Química e Petroquímica
--   Alimentícia                               -> Alimentícia e Bebidas
--   Refrigeração, Infraestrutura              -> Energia e Utilities
--   Indústria BA e MG                          -> por assunto (temas abaixo)
--   (novo)                                    -> Papel e Celulose
--
-- Rodar: wrangler d1 execute hooke-news --remote --file scripts/migrate-segmentos-2026-11.sql

-- ---------- Editorias: 2 matérias por dia cada (10/dia no total) ----------
DELETE FROM editorias;
INSERT INTO editorias (name, max_per_run, active, sort, created_at, updated_at) VALUES
  ('Química e Petroquímica', 2, 1, 1, datetime('now'), datetime('now')),
  ('Alimentícia e Bebidas', 2, 1, 2, datetime('now'), datetime('now')),
  ('Papel e Celulose', 2, 1, 3, datetime('now'), datetime('now')),
  ('Mineração e Siderurgia', 2, 1, 4, datetime('now'), datetime('now')),
  ('Energia e Utilities', 2, 1, 5, datetime('now'), datetime('now'));

-- ---------- Temas existentes: mudam de editoria ----------
UPDATE themes SET editoria = 'Mineração e Siderurgia' WHERE editoria IN ('Mineração', 'Siderurgia', 'Metalurgia', 'Cimento');
UPDATE themes SET editoria = 'Química e Petroquímica' WHERE editoria IN ('Petróleo e Gás', 'Fertilizantes');
UPDATE themes SET editoria = 'Alimentícia e Bebidas' WHERE editoria = 'Alimentícia';
UPDATE themes SET editoria = 'Energia e Utilities' WHERE editoria IN ('Refrigeração', 'Infraestrutura');
-- A Siderurgia estava desligada como editoria; os temas dela passam a valer.
-- Ponte Salvador–Itaparica não é energia/utilidades: fica desligada (dá para religar no painel).
UPDATE themes SET active = 0 WHERE editoria = 'Energia e Utilities' AND value = 'ponte Salvador Itaparica';
-- Indústria BA e MG: o Polo de Camaçari vai para Química; os temas genéricos
-- ficam desligados, substituídos pelas buscas regionais de cada segmento abaixo.
UPDATE themes SET editoria = 'Química e Petroquímica' WHERE editoria = 'Indústria BA e MG' AND value = 'Polo Industrial de Camaçari';
UPDATE themes SET editoria = 'Química e Petroquímica', active = 0 WHERE editoria = 'Indústria BA e MG';

-- ---------- Temas novos ----------
INSERT INTO themes (id, editoria, kind, value, priority, active, created_at, created_by) VALUES
  (lower(hex(randomblob(16))), 'Química e Petroquímica', 'busca', 'indústria química petroquímica', 0, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Química e Petroquímica', 'busca', 'química petroquímica Bahia', 1, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Alimentícia e Bebidas', 'busca', 'indústria de bebidas fábrica cervejaria', 0, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Alimentícia e Bebidas', 'busca', 'indústria alimentos bebidas Bahia', 1, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Alimentícia e Bebidas', 'busca', 'indústria alimentos bebidas Minas Gerais', 1, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Papel e Celulose', 'busca', 'papel e celulose indústria', 0, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Papel e Celulose', 'busca', 'fábrica de celulose investimento', 0, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Papel e Celulose', 'busca', 'celulose Bahia', 1, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Papel e Celulose', 'busca', 'celulose Minas Gerais', 1, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Mineração e Siderurgia', 'busca', 'siderurgia Minas Gerais', 1, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Energia e Utilities', 'busca', 'energia indústria subestação geração', 0, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Energia e Utilities', 'busca', 'hidrogênio verde', 0, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Energia e Utilities', 'busca', 'energia eólica solar Bahia', 1, 1, datetime('now'), 'migracao-segmentos'),
  (lower(hex(randomblob(16))), 'Energia e Utilities', 'busca', 'energia Minas Gerais indústria', 1, 1, datetime('now'), 'migracao-segmentos');

-- ---------- Notícias já geradas (publicadas, pendentes e recusadas) ----------
-- Pendentes de "Indústria BA e MG": classificadas pelo assunto.
UPDATE items SET data = json_set(data, '$.sector', 'Mineração e Siderurgia')
  WHERE json_extract(data, '$.sector') = 'Indústria BA e MG' AND json_extract(data, '$.title') LIKE '%Serra Dourada%';
UPDATE items SET data = json_set(data, '$.sector', 'Energia e Utilities')
  WHERE json_extract(data, '$.sector') = 'Indústria BA e MG' AND json_extract(data, '$.title') LIKE '%hidrogênio%';
UPDATE items SET data = json_set(data, '$.sector', 'Química e Petroquímica')
  WHERE json_extract(data, '$.sector') = 'Indústria BA e MG';

UPDATE items SET data = json_set(data, '$.sector', CASE json_extract(data, '$.sector')
    WHEN 'Mineração' THEN 'Mineração e Siderurgia'
    WHEN 'Siderurgia' THEN 'Mineração e Siderurgia'
    WHEN 'Metalurgia' THEN 'Mineração e Siderurgia'
    WHEN 'Cimento' THEN 'Mineração e Siderurgia'
    WHEN 'Petróleo e Gás' THEN 'Química e Petroquímica'
    WHEN 'Fertilizantes' THEN 'Química e Petroquímica'
    WHEN 'Alimentícia' THEN 'Alimentícia e Bebidas'
    WHEN 'Refrigeração' THEN 'Energia e Utilities'
    WHEN 'Infraestrutura' THEN 'Energia e Utilities'
  END)
  WHERE json_extract(data, '$.sector') IN ('Mineração', 'Siderurgia', 'Metalurgia', 'Cimento', 'Petróleo e Gás',
    'Fertilizantes', 'Alimentícia', 'Refrigeração', 'Infraestrutura');

-- Nome traduzido antigo da editoria (se houver) sai: o site traduz o novo nome.
UPDATE items SET data = json_remove(data, '$.translations."pt-PT".sector', '$.translations.en.sector',
    '$.translations.es.sector', '$.translations."zh-CN".sector')
  WHERE json_type(data, '$.translations') = 'object';
