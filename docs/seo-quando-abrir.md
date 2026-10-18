# SEO: como abrir a landing para os buscadores

Hoje a landing (`web/index.html`) tem `noindex, nofollow`, `canonical` e as tags `og:*` e `twitter:*` (cartão de pré-visualização ao colar o link em WhatsApp, LinkedIn e e-mail). O endereço absoluto é o alias provisório `https://argossentinel.vercel.app/`.

## Quando abrir

Decisão de Michel. Antes de abrir: Termômetro com desfechos publicáveis, parecer sobre CNPI, e o formulário de contato com endereço próprio (para não expor o alternativo ao spam).

## O que fazer (um commit)

1. Em `web/index.html`, apagar a linha `<meta name="robots" content="noindex, nofollow">` (e o comentário acima dela).
2. Criar `web/robots.txt`:

   ```
   User-agent: *
   Allow: /
   Disallow: /saude.html
   Disallow: /api/

   Sitemap: https://argossentinel.vercel.app/sitemap.xml
   ```

3. Criar `web/sitemap.xml` só com a landing (`verificar.html` fica de fora até haver prova pública para mostrar):

   ```
   <?xml version="1.0" encoding="UTF-8"?>
   <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
     <url><loc>https://argossentinel.vercel.app/</loc></url>
   </urlset>
   ```

4. Com domínio próprio, trocar `argossentinel.vercel.app` em `index.html`, `robots.txt` e `sitemap.xml`.

Não publique `robots.txt` com `Disallow: /` enquanto o `noindex` for a proteção: o buscador precisa conseguir ler a página para obedecer o `noindex`.

`saude.html` e `verificar.html` já têm `noindex` na própria página.
