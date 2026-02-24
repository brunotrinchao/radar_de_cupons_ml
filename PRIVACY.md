# Política de Privacidade - ML Captura de Cupons

Última atualização: 24 de fevereiro de 2026

## 1. Visão geral
A extensão **ML Captura de Cupons** foi desenvolvida para automatizar a aplicação de cupons no site do Mercado Livre.

## 2. Coleta de dados
A extensão **não coleta dados pessoais sensíveis** (como documentos, senhas, dados bancários ou biometria).

A extensão pode processar, localmente no navegador, as seguintes informações necessárias ao funcionamento:
- Estado da execução (iniciar, pausar, concluir);
- Filtro de busca informado pelo usuário;
- Horário de agendamento configurado;
- Log com títulos de cupons aplicados.

## 3. Uso dos dados
As informações são usadas exclusivamente para:
- Executar a captura automática de cupons;
- Exibir status e histórico da execução no popup da extensão;
- Retomar execução após pausa/agendamento.

## 4. Armazenamento
Os dados são armazenados localmente usando a API `chrome.storage` no navegador do usuário.

## 5. Compartilhamento
A extensão **não vende, compartilha ou transfere** dados pessoais para terceiros.

## 6. Código remoto
A extensão **não utiliza código remoto**. Todo o código executado é empacotado localmente na própria extensão.

## 7. Permissões utilizadas
- `alarms`: agendamento e retomada automática da captura;
- `scripting`: execução do script de captura na página de cupons;
- `storage`: armazenamento local de estado, filtro, agendamento e logs;
- `tabs`: identificação da aba ativa e navegação entre páginas de cupons;
- `webNavigation`: continuidade da captura após carregamento de páginas;
- `host_permissions` (`https://*.mercadolivre.com.br/*`): atuação restrita às páginas do Mercado Livre necessárias para a funcionalidade.

## 8. Direitos do usuário
O usuário pode, a qualquer momento:
- Remover a extensão;
- Limpar os dados locais da extensão pelo navegador.

## 9. Contato
Para dúvidas sobre esta Política de Privacidade, entre em contato com o desenvolvedor responsável pela publicação da extensão.
