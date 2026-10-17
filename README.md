# Looply

Reconstrução independente do Looply com uma página HTML por área e Supabase como backend.

## Páginas

- `login.html`: tela antiga de login, com a mesma estrutura e folha visual.
- `home.html`: boas-vindas com foto do perfil, stories com expiração em 24 horas e feed social.
- `galeria.html`: acervo antigo privado, visualizador de fotos/vídeos/áudio e comentários. Publicações sociais ficam no Início.
- `musicas.html`: playlist do YouTube conforme o usuário, dedicatórias e comentários.
- `chat.html` e `conversa.html`: lista de conversas e uma rota própria por conversa; anexos e gravação de áudio.
- `cartas.html`: coleção de cartas arquivadas e lista de cartas privadas trocadas com Peixinho; o acervo antigo permanece nesta área.
- `notificacoes.html`: atividade persistente de posts, comentários, respostas, dedicatórias, mensagens e cartas.
- `usuarios.html`: busca de perfis visíveis e acesso ao perfil ou chat.
- `perfil.html`: edição do nome de exibição, foto, biografia e privacidade; consulta de outros perfis.
- `configuracoes.html`: tema, fonte e tamanho de texto sincronizados no perfil do Supabase.
- `admin.html`: consultas administrativas auditadas e importação do acervo antigo, somente para Peixinho.

As páginas compartilham os módulos em `src/`, mas cada uma tem seu próprio HTML, JavaScript de entrada e folha CSS em `assets/css/pages/`. A lista da playlist é carregada por uma função Vercel em `api/youtube-playlist.js`, que valida a sessão Supabase e consulta a YouTube Data API no servidor. A chave do YouTube não é incluída em `config.js`, nos arquivos estáticos nem no JavaScript enviado ao navegador. Quando a lista é carregada, tocar numa faixa abre um reprodutor sobreposto no próprio app; fechar o reprodutor interrompe a música e não redireciona a página. O ID enviado para Peixinho está em `src/youtube-playlist.js`.

## Configuração e execução

`config.js` contém apenas a URL do projeto Supabase e sua publishable key, que é pública por definição. A chave da YouTube Data API fica numa variável Vercel sensível chamada `LOOPLY_YOUTUBE_API_KEY`, lida exclusivamente pela função de servidor. A função também usa `LOOPLY_SUPABASE_URL` e `LOOPLY_SUPABASE_PUBLISHABLE_KEY` para validar a sessão recebida. Nunca coloque senhas, `service_role`, tokens privados ou a chave do YouTube no GitHub ou no JavaScript do navegador. Restrinja a chave no Google Cloud à YouTube Data API v3; como a chamada agora é servidor a servidor, não use restrição HTTP de referenciador. Para executar localmente, use Node.js 22 ou posterior e sirva a raiz por HTTP.

```text
node scripts/build.mjs
node --test tests/foundation.test.mjs tests/youtube-api.test.mjs
```

O build gera `dist/` com as páginas estáticas e os módulos do navegador. O conteúdo da pasta de referência em `work/legacy-app/` não é publicado pelo build.

## Contas e dados

O login converte o username confirmado em e-mail e autentica com Supabase Auth. As quatro contas existentes são `Patati`, `Misol`, `Yara` e `Peixinho`; o UUID e o perfil de cada uma vêm do projeto Supabase. Peixinho tem a associação administrativa no backend. Senhas não ficam no código.

As migrações em `supabase/migrations/` definem tabelas, relacionamentos, buckets privados, políticas RLS e funções. Fotos, vídeos e anexos enviados pela aplicação usam esses buckets privados e recebem URLs assinadas depois da autorização.

## Conteúdo antigo e itens ainda pendentes

A cópia local de referência contém 97 cartas (47 Misol, 42 Patati e 8 Yara) e 256 caminhos únicos de mídia catalogados (209 referências comuns e 48 exclusivas, com uma repetida entre as listas). O esquema das cartas arquivadas já foi aplicado ao projeto Supabase; os buckets continuam privados e os objetos do acervo ainda não foram enviados. A migration `20261016120549_stories_24h_private_media_realtime` acrescentou stories de 24 horas, regras de destinatários, Storage privado e Realtime sem alterar as cartas existentes. A aplicação inclui importação auditada no painel de Peixinho. As cartas são enviadas individualmente à Edge Function; cada mídia é enviada separadamente ao Storage por TUS em blocos de 6 MiB e só depois registrada pela função com seus metadados. Itens ausentes, inválidos ou rejeitados são contabilizados e ignorados para que os demais continuem. Os stories expirados deixam de ser consultáveis no banco e no Storage pelas políticas RLS, e a URL assinada de cada mídia tem duração limitada ao fim do story. A remoção física dos dados expirados é feita em lotes de até 100 itens quando alguém abre a Home ou quando um story expira; não existe cron configurado para limpar o banco quando ninguém acessa o app. O build não publica cartas nem arquivos de mídia.

Para importar o acervo, extraia `Loooply-main.zip` em uma pasta local. Depois que a atualização do branch estiver na prévia Vercel, entre como Peixinho, abra Administração, informe um motivo com pelo menos 20 caracteres, escolha a pasta extraída completa `Loooply-main` e inicie a importação. O processo lê as cartas e o catálogo local no navegador e envia os arquivos ao bucket privado. Ele usa somente os caminhos catalogados, preserva as audiências exclusivas e as descrições `MSG_*.txt` junto às mídias; mídias catalogadas que não estiverem na pasta selecionada são ignoradas, sem bloquear as cartas e demais arquivos disponíveis. Uma falha em uma carta ou mídia é mostrada no resumo e não interrompe o processamento dos itens seguintes. Nenhuma senha de conta, carta ou chave privada entra no repositório. Repita a importação para retomar falhas.

Passo a passo da importação pelo app:

1. Extraia o ZIP completo e localize a pasta `Loooply-main` que contém `midia-index.json` (na raiz, como está no ZIP antigo, ou dentro de `data/`), a pasta `midia/` e os arquivos de cartas `.txt`.
2. Abra a URL da prévia atualizada do Looply e entre com a conta administrativa Peixinho.
3. Abra **Administração** na navegação.
4. Na seção **Importar cartas e mídias antigas**, informe um motivo com pelo menos 20 caracteres (por exemplo, `Restaurar o acervo antigo do Looply para os usuários autorizados.`).
5. No seletor **Pasta Loooply-main**, escolha a pasta extraída completa. O seletor de pasta do navegador incluirá os arquivos internos.
6. Clique **Importar acervo** e aguarde os contadores de progresso e o resultado final. Mantenha a página aberta até terminar.
7. Verifique **Cartas** e **Galeria** com cada conta autorizada. A importação ignora arquivos de mídia ausentes do índice/pasta; cartas e outros arquivos disponíveis continuam sendo importados.
8. Se a rede cair ou houver erros de upload, volte ao painel e repita a importação com a mesma pasta; os registros/objetos já existentes são tratados para permitir retomada sem duplicação.

A lista pesquisável requer uma chave da YouTube Data API v3 no Google Cloud e a variável sensível `LOOPLY_YOUTUBE_API_KEY` no Vercel. Mantenha essa variável apenas nos ambientes autorizados; o código do navegador chama `/api/youtube-playlist` com a sessão Supabase, e a função verifica o usuário antes de consultar o Google. Configure também `LOOPLY_SUPABASE_URL` e `LOOPLY_SUPABASE_PUBLISHABLE_KEY` como variáveis do servidor. Restrinja a chave Google à YouTube Data API v3. Não adicione a chave a `config.js`, a arquivos versionados ou a logs. O player incorporado continua disponível mesmo quando a função ou a API estiver indisponível.

O build e os testes automatizados desta revisão validam a estrutura e os fluxos simulados da interface. Ainda faltam a importação real das cartas/mídias, testes de navegador com as quatro contas (incluindo duas sessões e isolamento de acesso), validação visual por screenshots, testes móveis e confirmação de todos os fluxos na prévia. Build e testes automatizados não comprovam a operação ponta a ponta.

Para a publicação, use o branch/PR de trabalho no repositório `soumoiss/Looply`. Configure no Vercel Build Command `npm run build` e Output Directory `dist`. A prévia da PR deve ser validada antes de qualquer publicação em produção.

