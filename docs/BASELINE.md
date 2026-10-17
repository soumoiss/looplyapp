# Diagnóstico da base anterior

Data da análise: 15 de outubro de 2026.

## Identidade e estrutura

A referência é o repositório público [soumoiss/Loooply](https://github.com/soumoiss/Loooply). Ele contém páginas estáticas para início, login, Home, perfil, galeria, músicas e administração. A interface usa lilás como tema principal, cartões arredondados, fundos suaves, uma marca desenhada em torno de um círculo e cinco temas: lilás, noite, oceano, rosa e floresta. A frase de marca mais recorrente é “cartas aos amigos ;)”.

Os módulos atuais incluem cartas, calendário e filtros na Home; leitura de mídia na galeria; playlists do YouTube e comentários por música; comentários locais ou sincronizados; perfil; e uma tela de administração.

## Problemas e limites encontrados

- A autenticação começou como registro local no navegador. O relatório da própria base descreve senhas antigas no JavaScript e depois hashes comparados no cliente; isso nunca substitui autorização no backend.
- A Home original era um monólito. A organização foi depois dividida em módulos, mas continua sendo um conjunto de páginas estáticas, sem uma arquitetura de aplicação única.
- A nuvem anterior cobria perfis e comentários de músicas, mas os relatórios dizem que não havia chat entre usuários, cadastro remoto completo nem teste real com duas sessões.
- Parte dos comentários e históricos podia permanecer somente no IndexedDB do dispositivo.
- O pacote analisado registra 248 mídias referenciadas que não vieram junto do pacote de recuperação. A nova plataforma não vai depender desses caminhos locais.
- Uma chave da API do YouTube foi identificada como visível no código cliente. Ela não foi copiada. O proprietário deve restringi-la ou rotacioná-la no Google Cloud.
- A documentação antiga menciona uma conta Peixinho administradora no Supabase antigo, mas essa identidade não existe no Supabase novo e não será importada.

## Nomes de usuário observados

O registro JavaScript antigo contém Patati, Misol, Lilika e YARA. A documentação do backend antigo descreve peixinho como administrador. O prompt novo cita Patati, Yara, Peixinho, Sol e Misol, e deixa Misol condicionado à confirmação.

Após a confirmação do usuário, os únicos usernames a preservar são Patati, Misol, Yara e Peixinho; Peixinho será o administrador. A caixa canônica será minúscula no banco (`yara`). Lilika e Sol não foram confirmados e não serão carregados. Nenhuma conta antiga, UUID, e-mail, senha, hash ou papel foi carregado. A conta administrativa só será associada depois que Peixinho tiver uma identidade nova e verificada no Auth.

## Infraestrutura nova encontrada

- GitHub: [soumoiss/Looply](https://github.com/soumoiss/Looply), repositório privado com somente README e .gitignore no início do trabalho.
- Supabase: Looply V2, ativo e saudável na região us-east-1, recém-criado e sem tabelas de aplicação ou migrações.
- O projeto Supabase antigo permanece separado. A nova fundação usa somente o projeto V2.

## Critérios para esta primeira etapa

1. Reconstruir a camada visual e de autenticação sem importar conteúdo ou identidades antigas.
2. Criar perfis apenas a partir do Auth novo, com username validado e sem campo de papel editável.
3. Manter a lista administrativa em schema privado; a atribuição de administrador exigirá uma ação confiável posterior.
4. Construir as áreas seguintes em etapas: perfis, mídias, publicações e comentários, depois chat e mensagens especiais.
5. Verificar cada migração no projeto novo antes de avançar para a próxima etapa.

