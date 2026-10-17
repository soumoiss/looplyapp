# Roteiro de aceitação do Looply

Este roteiro registra 37 fluxos para validar a aplicação completa. Em 16 de outubro de 2026, o projeto Supabase `qixocgetiwlrsbadpbvh` contém a migration de stories de 24 horas e a publicação Realtime de metadados de mídia; `looply-admin` e `looply-chat` estavam nas versões 7 e 3 na última verificação. O acervo de cartas permanece no banco e os arquivos antigos ainda dependem de importação. O commit `65d3c05` passou no GitHub Actions com 37 testes e a atualização `823ba8a` passou com 38; esta revisão inclui a publicação Realtime de metadados de mídia e aguarda o novo check. Não houve teste completo de stories com duas contas nem expiração real no navegador. Build e testes automatizados não comprovam integração ponta a ponta.

## Preparação

1. Confirme que o projeto Supabase selecionado é `qixocgetiwlrsbadpbvh`, configure Site URL e redirecionamentos da prévia e mantenha o cadastro público desativado.
2. As quatro contas `patati`, `misol`, `yara` e `peixinho` já existem no Auth e seus perfis estão associados. Não recrie usuários nem copie senhas para o código, commits ou roteiro. Login não depende de SMTP.
3. Os UUIDs foram gerados pelo Supabase. Peixinho já está associado ao grupo administrativo por backend confiável; confira essa permissão antes do fluxo de teste.
4. Abra duas sessões independentes com contas diferentes. Use dados descartáveis e não íntimos nos testes; não registre senha, token, OTP ou URL assinada.
5. Antes de importar, gere o inventário com `node scripts/audit-legacy-archive.mjs`. Importe somente arquivos presentes no índice e associados aos quatro perfis ativos.

## Fluxos obrigatórios

| # | Ação | Resultado esperado | Estado |
|---|---|---|---|
| 1 | Abra o app, compare a tela de login com o ZIP e tente cadastro público e login com uma conta provisionada. | Login mantém a aparência antiga, não oferece cadastro e usa Auth; cadastro público é recusado. | Não executado |
| 2 | Entre, saia e tente reabrir uma área autenticada pelo histórico. | Logout encerra a sessão e retorna ao login. | Não executado |
| 3 | Recarregue uma sessão válida e abra a mesma conta em outro navegador/dispositivo. | Sessão e dados do perfil são recuperados pelo Supabase sem guardar senha no app. | Não executado |
| 4 | Entre com cada usuário e confira seu perfil. | Username, nome de exibição e UUID pertencem à conta certa; perfis não se misturam. | Não executado |
| 5 | Abra a coleção antiga de cartas, contagem, estado de leitura, filtros, calendário e modal. | Textos e metadados são preservados exatamente; contagem e estado correspondem à conta. | Pendente: importar o conteúdo e verificar por usuário |
| 6 | Crie e envie uma carta no desktop para o destinatário escolhido, com privacidade e data. | Prévia, envio, feedback e persistência funcionam sem duplicar ou sobrescrever carta importada. | Não executado |
| 7 | Crie e envie uma carta em viewport móvel, inclusive com anexo permitido. | Fluxo cabe em 390 px, permite seleção nativa de arquivo e persiste no backend. | Não executado |
| 8 | Envie fotografia para a galeria pelo desktop e celular. | Arquivo privado, associação ao registro, progresso, visualização e persistência funcionam. | Não executado |
| 9 | Envie um vídeo MP4/WebM pela galeria e abra-o após recarregar. | Validação de tipo/tamanho, upload e reprodução funcionam após nova sessão autorizada. | Não executado |
| 10 | Publique um post público e um privado/selecionado. | Apenas o público autorizado recebe o conteúdo; metadados e arquivo seguem a mesma permissão. | Não executado |
| 11 | Publique comentário de texto e comentário com foto/vídeo pelo seletor do celular. | Comentários persistem uma vez, anexo respeita a visibilidade do post e apresenta estados de envio/erro. | Não executado |
| 12 | Responda a um comentário, recarregue e tente anexar arquivos acima do limite. | Resposta mantém relação com o comentário/post; arquivo inválido é recusado e não deixa registro órfão. | Não executado |
| 13 | Abra comentário e anexo de post privado com outra conta sem permissão. | Post, comentários, respostas e arquivos ficam inacessíveis pela UI, API e URL direta. | Não executado |
| 14 | Abra a playlist atribuída ao usuário, use a busca/player e reproduza um item da biblioteca. | Playlist do YouTube, incluindo a de Peixinho, abre; itens pessoais vêm do perfil autenticado. | Prévia conferida: `looply` não tem `LOOPLY_YOUTUBE_API_KEY`; player incorporado aparece, mas a lista da API falha |
| 15 | Envie uma dedicatória musical para outra pessoa e abra-a nas duas contas. | Remetente/destinatário veem a dedicatória conforme a política; terceiros não a veem. | Não executado |
| 16 | Comente uma dedicatória como privado e depois compartilhe com os participantes. | Comentário privado começa visível só ao autor; compartilhamento persiste apenas para participantes. | Não executado |
| 17 | Inicie conversa privada entre duas contas, envie texto, recarregue e consulte histórico. | Conversa única, participantes corretos e mensagens persistentes. | Não executado |
| 18 | Envie foto/vídeo permitido no chat e tente abrir o objeto como não participante. | Anexo privado é acessível apenas aos participantes e usa URL temporária. | Não executado |
| 19 | Mantenha duas sessões abertas e envie mensagens/notificações sem recarregar. | Realtime atualiza mensagens, notificações e leitura em ambos os lados. | Não executado |
| 20 | Envie carta especial para Peixinho e responda pela conversa correspondente. | Só remetente e Peixinho veem a carta; autoria e histórico ficam corretos e o acesso é auditado. | Não executado |
| 21 | Como Peixinho, abra conteúdo privado informando motivo válido; repita como usuário comum. | Leitura administrativa exige verificação server-side e auditoria anterior à entrega; usuário comum é negado. | Não executado |
| 22 | Publique comentário administrativo numa publicação privada e em uma mídia antiga exclusiva. | Peixinho permanece autor dos comentários; a auditoria registra pedido, sucesso ou falha. | Não executado |
| 23 | Teste UUID e caminho de Storage conhecidos com conta não autorizada; repita com URL assinada expirada. | Conhecer ID/caminho não dá acesso; URL assinada expirada não funciona. | Não executado |
| 24 | Desconecte a rede durante upload, comentário e envio de mensagem; reconecte e tente novamente. | A UI não mostra sucesso falso, explica a falha e a repetição segura não cria duplicatas. | Não executado |
| 25 | Capture e compare todas as páginas em desktop e em 390 px; repita fluxos principais depois das correções. | Layout, textos, temas e interações permanecem fiéis ao ZIP, sem corte, rolagem horizontal ou regressões. | Pendente de screenshots/teste móvel |
| 26 | No painel de Peixinho, selecione a pasta extraída, informe um motivo e execute a importação; repita após interromper a rede. | Importa 97 cartas e 256 arquivos indexados, mostra erros por arquivo, retoma sem duplicatas e mantém o bucket privado. | Pendente: ação do usuário no navegador |
| 27 | Grave uma mensagem de voz no chat, teste duração, cancelar, pré-visualizar, enviar e ouvir em outra sessão. | O microfone só é pedido por ação explícita, áudio é anexado ao registro correto e o Storage continua privado aos participantes. | Não executado em navegador |
| 28 | Gere comentário, resposta, post público/selecionado e dedicatória; confira a central em duas contas. | Notificações sociais persistem, só chegam às pessoas previstas por RLS, abrem o destino correto e sincronizam leitura. | Migração e UI implementadas; fluxo integrado não executado |
| 29 | Altere tema, fonte e tamanho em uma conta e entre na mesma conta em outro dispositivo. | Preferências são salvas no perfil, reaplicadas em cada página e sincronizadas sem depender só do armazenamento local. | Migração e UI implementadas; fluxo integrado não executado |
| 30 | Acesse diretamente cada URL nova, atualize a página e use voltar, navegação principal e barra móvel. | Rotas de conversa, cartas, notificações, usuários e configurações carregam sob sessão e mantêm a navegação global. | Build/testes estáticos passaram; navegador pendente |
| 31 | Abra uma conversa em desktop e celular e confira avatar, nome, prévia, horário, não lidas e mensagens antigas. | Lista e rota individual distinguem conversas, protegem IDs inválidos e preservam a rolagem no histórico paginado. | Implementado no branch; navegador pendente |
|32 | Crie um grupo com nome e pelo menos duas outras contas; abra-o nas duas sessões e envie texto e anexo. | Cada integrante autorizado vê o título, os participantes, as mensagens, os anexos e as notificações; contas fora do grupo não conseguem ler nenhum desses dados. | Formulário conferido na prévia; criação, isolamento e teste entre sessões pendentes |
|33 | No menu do avatar, abra Perfil, Pessoas e Configurações e use a navegação principal em celular. | As seis abas principais permanecem visíveis e o perfil, a busca de pessoas, as configurações e a administração ficam acessíveis no menu da conta. | Passou para navegação/menu em 390 px, sem overflow horizontal; demais fluxos pendentes |

| 34 | Publique um story público e abra-o com outra conta autenticada; confira foto, vídeo, texto e lista de stories. | O conteúdo aparece apenas para membros autenticados, o player permanece dentro do app e a posição segue a ordem dos stories. | Não executado |
| 35 | Publique stories privados e para pessoas escolhidas; tente acessar como remetente, destinatário permitido e uma terceira conta. | O autor e os destinatários permitidos veem o conteúdo; terceiros não obtêm metadados, URL assinada nem arquivo direto. | Não executado |
| 36 | Confira Home, Cartas e Galeria com o acervo já existente. | Home contém boas-vindas, stories e feed; Cartas continua exibindo cartas arquivadas; Galeria contém o acervo e comentários, sem duplicar publicações do feed. | Teste estrutural automatizado; validação visual pendente |

| 37 | Publique uma foto/vídeo em post e Story e observe a outra conta autorizada sem atualizar manualmente. | A publicação e o metadado de mídia acionam refresh Realtime; RLS continua impedindo metadados de audiências sem acesso. | Não executado |

## Registro e critério de conclusão

Marque cada fluxo `Passou` somente depois de executá-lo. Registre data, username de teste e evidência sanitizada (por exemplo, screenshot sem conteúdo íntimo). Em falha, registre o resultado observado, corrija a causa e repita os fluxos relacionados. Nunca registre e-mail pessoal adicional, senha, OTP, token de sessão, conteúdo de carta privada ou URL assinada.

O PR permanece em rascunho até os fluxos relevantes terem evidência, a identidade administrativa estar verificada, a comparação de telas estar aprovada e as lacunas de dados terem sido explicitadas.
