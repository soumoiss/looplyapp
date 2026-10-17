# Auditoria do ZIP antigo

O ZIP original permanece inalterado. A cópia extraída está em `work/legacy-app/Loooply-main`; `work/` é ignorado pelo Git. O script `scripts/audit-legacy-archive.mjs` calcula tamanho, SHA-256, tipo e associação aparente a partir do nome do arquivo e gera `work/legacy-app/manifest.json`. Ele calcula hashes de bytes, mas não decodifica, exibe ou persiste o texto das cartas, nem envia dados ao Supabase.

## Resultado verificado

- A cópia extraída contém as sete páginas HTML originais: `index.html`, `login.html`, `home.html`, `galeria.html`, `musicas.html`, `perfil.html` e `admin.html`. Foram removidos da cópia local os arquivos de cartas e entradas de índice que pertenciam à conta desativada; o ZIP-fonte segue como arquivo original separado.
- 97 arquivos seguem o padrão de cartas: 42 têm o prefixo `Patati`, 47 `Misol` e 8 `YARA`. Há dois arquivos TXT de suporte que não seguem esse padrão. Uma das 97 cartas é privada e protegida por senha; o importador mantém o texto/hash dessa carta fora da tabela pública e verifica a senha no servidor.
- O índice antigo em `midia-index.json` lista 41 referências comuns e 5 referências exclusivas; 34 dos 46 caminhos únicos estão na cópia e 12 não foram localizados.
- O índice principal em `data/midia-index.json` lista 209 referências comuns e 48 referências exclusivas (37 de Misol e 11 de Yara). Uma mídia aparece nas duas listas; são 256 caminhos únicos, todos presentes na pasta `midia/`. A mídia exclusiva fica em pastas próprias, e uma pasta que não faça parte das audiências autorizadas é ignorada.
- `data/musicas-index.json` contém zero itens.
- As duas cópias de índice de mídia divergem. O importador usa `data/midia-index.json`, pois é o catálogo completo com destinatários; a cópia antiga incompleta não é usada para decidir autorização.

## Estado da migração

Nenhuma carta, fotografia, vídeo ou áudio do ZIP foi importado para o Supabase novo. As tabelas, políticas RLS, controles de acesso e o fluxo de importação já foram implementados; as duas migrações estão aplicadas no projeto remoto e a Edge Function administrativa está na versão 5. O importador está no código local, mas ainda precisa chegar à prévia atualizada. Depois, Peixinho deverá selecionar a pasta extraída no painel para iniciar o envio. O manifesto local registra hashes para detectar alterações. Não inclua o manifesto nem arquivos pessoais do ZIP em commits.

## Interface observada no código

O login antigo usa nome de usuário, senha com botão de mostrar/ocultar, “Avante!”, link de recuperação e marca “Looply · MoissWorld”. A home tem navegação vertical para Galeria/Músicas, avatar, coleção de cartas, contador, filtros, calendário, lista e modal. Galeria e Músicas usam `container-page`, cabeçalho de marca, hero, toolbar e visualizações próprias. Perfil e Administração são páginas separadas. A estrutura da home e da galeria arquivada foi reconstruída no código local; ainda falta comparar visualmente as páginas com screenshots da referência.

## Comportamentos encontrados nos módulos JavaScript

Esta seção descreve a lógica inferida do código-fonte, sem abrir os textos das cartas ou copiar dados privados.

### Login, sessão e perfil

- `session.js` encaminha o login ao Supabase quando a configuração antiga de nuvem está habilitada. Caso contrário, verifica o usuário contra uma lista local e compara o SHA-256 da senha digitada com um hash local. Isso não é um fluxo de cadastro nem um provedor confiável de autenticação.
- `cloud.js` transforma nomes em e-mails no domínio do produto, chama `signInWithPassword` e procura/cria o perfil pelo UUID do usuário autenticado. A integração antiga é opcional e carrega o SDK Supabase em tempo de execução; sua configuração e suas chaves não devem ser copiadas.
- O navegador guarda username, avatar, papel e estado de sessão no `localStorage`; sair limpa essas chaves e também tenta encerrar a sessão remota. A persistência local não é compartilhada entre dispositivos e o papel local não é uma autorização suficiente.
- A foto do perfil vem do valor associado à sessão. Quando a imagem falha ou está vazia, a página mostra as iniciais. Perfil também guarda localmente tema, preferência de movimento reduzido e contador de cartas lidas.
- `theme.js` aplica paletas por variáveis CSS e persiste a escolha no navegador. Os temas encontrados incluem lilás, noite, oceano, rosa e floresta.

### Cartas e estado de leitura

- A home cria entradas para a coleção configurada e sondas para cartas privadas. O repositório monta nomes de arquivo a partir do username; para cartas privadas, tenta tanto numeração com um dígito quanto com dois dígitos.
- Os arquivos `.txt` são buscados diretamente como texto. O código analisa metadados, extrai datas, cria títulos automaticamente e mantém estados de carregamento, indisponibilidade e erro. A carga em lote usa até seis solicitações concorrentes.
- A lista oferece filtros de todas as cartas, cartas sem data e datas selecionadas no calendário; abrir uma carta exibe um modal com anterior/próxima. O estado “lida” é salvo no `localStorage` por username.
- Cartas protegidas são baixadas ao navegador antes da verificação da senha e o texto protegido fica disponível no próprio cliente após o desbloqueio local. Portanto, a proteção antiga é apenas uma barreira de interface: não é controle de acesso para conteúdo privado. Na reconstrução, arquivos privados devem permanecer no Storage privado e ser autorizados no servidor antes de entregar o conteúdo.
- Não foi encontrado, nesta auditoria, um fluxo completo para criar e enviar cartas a partir da aplicação antiga; a funcionalidade de criação mobile e persistência no backend permanece nova.

### Galeria, mídia e comentários de fotografia

- `gallery.js` baixa o índice JSON indicado na configuração antiga. Aceita uma lista simples ou coleções como `items`, `fotos`, `videos`, `audios` e agrupamentos exclusivos por usuário. Tipo, título, data, dono e exclusividade podem ser inferidos dos metadados ou do caminho do arquivo.
- A interface suporta pesquisa textual, filtro por tipo, data e exclusividade, ordenação e modos grade, lista e mosaico, além de visualizador/lightbox. A renderização é dividida em lotes de 30 itens.
- A regra antiga de visibilidade é aplicada no JavaScript: itens sem marca exclusiva são mostrados; itens exclusivos com proprietário são filtrados pelo username da sessão. Essa filtragem no cliente não protege o arquivo ou o índice contra requisições diretas e não deve ser reutilizada como autorização.
- Fotografias podem abrir uma janela para exibir um comentário associado à mídia. Isso não equivale ao novo sistema de comentários com autoria, respostas, políticas RLS e anexos mobile.

### Músicas e comentários

- `music.js` seleciona uma playlist por username a partir de uma configuração no cliente, consulta páginas da YouTube Data API, constrói a lista e abre o player incorporado em modo de privacidade aprimorada. O código antigo também contém uma credencial de API do YouTube embutida no JavaScript público. Ela não foi copiada para o novo projeto; se ainda estiver ativa, deve ser revogada/rotacionada no provedor.
- A chave de comentários é derivada da playlist e do vídeo, permitindo recuperar o mesmo fio ao reabrir a faixa. Os comentários aceitam texto e até seis fotografias de no máximo 12 MB cada.
- Com a nuvem antiga ligada, comentários e anexos são enviados ao Supabase e anexos recebem URLs assinadas temporárias. Sem nuvem, comentários e blobs ficam no IndexedDB do dispositivo. Esse fallback não sincroniza entre aparelhos nem implementa privacidade por participante.

### Administração e lacunas de produto

- A página antiga de administração carrega uma visão de perfis e comentários musicais quando o cliente Supabase está configurado, com abas de usuários/comentários, pesquisa, atualização e logout. A consulta verifica o papel do perfil no módulo de nuvem, mas a autorização final depende de RLS e não deve depender do frontend.
- A auditoria do código não identificou um módulo completo de chat privado, notificações ou envio de cartas com anexos. A implementação nova precisa criá-los e integrar participantes, autoria, persistência e autorização no backend.
- A credencial de API embutida, autenticação local por lista de usuários, sessões locais, estado de leitura local, comentários em IndexedDB e exclusividade decidida no navegador são limitações concretas do legado; documentam comportamento visual, não padrões de segurança para a nova arquitetura.

### Consequências para a reconstrução

1. A interface e a sequência visual das páginas devem ser comparadas com o ZIP antes de qualquer redesenho; os fluxos de nuvem, permissões e persistência serão substituídos pela arquitetura nova.
2. Nenhum dado protegido poderá ser apenas escondido por JavaScript ou baixado antecipadamente para o navegador. RLS e Storage privado devem validar a autorização antes de ler os dados/arquivos.
3. A migração precisa separar conteúdo público, conteúdo privado por proprietário/destinatário e conteúdo administrativo; nomes de arquivo são pistas, não prova de associação.
4. O comportamento local legado que não sincronizava (leituras, preferências e comentários offline) precisa ser explicitamente classificado como preferência local ou migrado para tabelas/contas no novo backend, conforme a regra de negócio.

## Comparação com a fundação nova

- O login no branch mantém os rótulos, os campos username/senha, o botão “Avante!”, a recuperação de acesso, a marca e o rodapé do login legado. A página de preview correspondente foi reaberta em uma aba nova; uma aba antiga mostrava conteúdo de outro deployment e não foi usada como evidência. A inspeção do navegador confirmou os elementos textuais/controles; ainda falta captura e comparação pixel a pixel com a origem, pois o navegador não permite abrir o arquivo `file://` local do ZIP.
- O código novo tem páginas HTML e entradas JavaScript independentes para início, galeria, músicas, chat/cartas, perfil e administração. A home integra publicações persistidas com a coleção de cartas arquivadas, filtros, calendário, estado de leitura e modal; a galeria integra o acervo catalogado, visualizador e comentários.
- As migrações novas criam as tabelas, políticas e funções para as cartas arquivadas e para a mídia antiga. A coleção e a galeria estão implementadas no código local, mas os 97 textos e 256 arquivos ainda não foram importados para o banco e o bucket privados.
- As quatro contas já estão criadas no Supabase e Peixinho já tem privilégio administrativo. Não foi feito login de navegador nesta etapa. A playlist do YouTube foi reintegrada por player incorporado, inclusive o ID de Peixinho, sem copiar a chave de API do código legado.

## Próxima etapa

1. Atualizar a PR #1 e aguardar a prévia Vercel com o importador.
2. Entrar como Peixinho, selecionar a pasta extraída no painel e importar as 97 cartas e as 256 mídias indexadas.
3. Validar as contagens e permissões por usuário; nenhum conteúdo fora do catálogo aprovado será enviado.
4. Comparar as páginas com screenshots da referência e executar os fluxos da matriz de aceitação em navegador.

