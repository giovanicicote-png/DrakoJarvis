# Drako AI — protótipo iPhone (v0.1)

Interface PWA em HTML/CSS/JavaScript, sem build e sem dependências.

## O que funciona
- Interface preta e verde neon responsiva.
- Chat de demonstração local.
- Histórico de conversa durante a sessão.
- Síntese de fala pelo navegador (quando disponível).
- Entrada por voz se o navegador oferecer `SpeechRecognition`.
- Manifesto PWA e cache básico para acesso offline após a primeira visita.

## O que NÃO funciona ainda
Esta versão não contém modelo de IA, não tem tokens ilimitados, não cria arquivos fora do navegador, não executa terminal, não navega em outros apps e não faz automação autônoma. As respostas são locais e demonstrativas.

## Publicar gratuitamente usando só o iPhone
1. Abra `https://github.com` no Safari e entre/crie sua conta.
2. Crie um repositório novo chamado `drako`.
3. Use **Add file → Upload files** para enviar os cinco arquivos desta pasta (não envie o ZIP; extraia-o primeiro no app Arquivos do iPhone).
4. No repositório, abra **Settings → Pages**.
5. Em **Build and deployment**, selecione **Deploy from a branch**, escolha `main` e `/ (root)`, e salve.
6. Aguarde a publicação. O endereço será semelhante a `https://SEU-USUARIO.github.io/drako/`.
7. Abra o endereço no Safari do iPhone, toque em **Compartilhar → Adicionar à Tela de Início**.

Os nomes dos menus podem mudar. Não coloque chaves de API neste repositório público.

## Próxima etapa para virar um agente real
Será necessário conectar um backend seguro a um modelo de IA e a um executor isolado de código. Não coloque chaves secretas no JavaScript público. Para custo zero, as cotas gratuitas de serviços externos são limitadas e podem mudar; nenhum provedor garante tokens ilimitados.
