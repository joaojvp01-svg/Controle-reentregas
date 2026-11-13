# Controle de Reentregas · CD Barueri

App web para registrar e acompanhar **reentregas (VD e VET), NFDs, ocorrências e notas canceladas**, com aprovação do ADM, cruzamento automático com o consolidado de faturamento e dashboard.

## O que muda em relação à planilha

| Antes (planilha) | Agora (app) |
|---|---|
| Operação lança na aba "Recebimento" e o ADM copia para PA ou VET | Operação lança uma vez; o ADM só **aprova**. Não precisa copiar nada |
| Canal (PA/VET) escolhido na mão: 113 notas de VD estavam na aba VET | Canal vem do **consolidado** pela NF |
| Motivo digitado livre (200+ grafias) | Lista padronizada (editável no Admin) |
| Valor, peso, cliente e representante faltando | Preenchidos sozinhos pelo consolidado |
| Foto de NFD/ocorrência e avarias em outro lugar | Fotos anexadas ao próprio lançamento, com descrição |
| Não dava pra saber quantas vezes a nota voltou | Ao digitar a NF aparece "já voltou N×" e o dashboard lista as reincidentes |

## Perfis

- **Operação**: entra só com o nome (e a senha da operação, se você configurar uma). Faz os lançamentos, consulta NF e vê o dashboard e os registros.
- **ADM**: usuário e senha. Aprova ou recusa, edita, exclui, sobe o consolidado e importa o histórico.

## Telas

1. **Registrar**: escolha Reentrega, NFD ou Ocorrência. NFD e Ocorrência têm foto do documento e fotos de avaria com descrição; a Ocorrência também tem o desconto do motorista (total, parcial ou sem desconto). Os dados do motorista ficam preenchidos para lançar várias notas do mesmo veículo. Ao digitar a NF + Enter, o app mostra cliente, canal, valor e peso, e avisa se a nota já voltou antes ou se tem NFD ou ocorrência.
2. **Aprovações** (ADM): aprova ou recusa em lote (recusa sempre por confirmação de endereço).
3. **Registros**: filtros, ordenação, coluna "Retornos" (quantas vezes a NF voltou em todo o histórico) e exportação para Excel.
4. **Dashboard**: KPIs, reentregas por dia/semana/mês por canal, taxa de reentrega por mês de faturamento, motivos, transportadoras, quantas vezes cada NF voltou, ranking (motoristas, representantes, clientes, cidades, turno), NFDs e ocorrências por motivo e a tabela de NFs reincidentes.
5. **Consulta NF**: dados do consolidado e linha do tempo de tudo que aconteceu com a nota.
6. **Admin**: upload do consolidado, importação da planilha antiga, listas (motivos, transportadoras, conferentes, horário dos turnos), motoristas e reprocessamento do cruzamento.

## Implantação na Vercel (mesmo esquema do app de Expedição)

1. Crie um repositório no GitHub (ex.: `controle-reentregas`) e suba o conteúdo desta pasta.
2. Na Vercel: **Add New → Project** e importe o repositório. Não precisa configurar build (Framework: *Other*).
3. Em **Storage**, conecte um banco **Upstash Redis** ao projeto. Isso cria sozinho as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`. Também dá para reaproveitar o banco de outro app criando uma base nova no Upstash.
4. Ainda em **Storage**, crie e conecte um **Blob** (Vercel Blob). É onde ficam as fotos das NFDs, das ocorrências e das avarias, e ele cria sozinho a variável `BLOB_READ_WRITE_TOKEN`.
5. Em **Settings → Environment Variables**, crie:
   - `ADMIN_USER`: usuário do ADM
   - `ADMIN_PASSWORD`: senha do ADM
   - `OPER_PASSWORD` *(opcional)*: senha única da operação. Sem ela, a operação entra só com o nome
   - `AUTH_SECRET` *(opcional, recomendado)*: qualquer texto longo aleatório
6. Faça **Redeploy**.

## Primeiro uso (ADM)

1. **Admin → 1. Consolidado**: envie o `FATURAMENTO_CONSOLIDADO_...xlsx`. Reenvie sempre que ele for atualizado (diário ou semanal): as NFs são sobrescritas e os registros que não tinham cruzado são reprocessados sozinhos.
2. **Admin → 2. Importar histórico**: envie a planilha `CONTROLE_DE_REENTREGAS`. O app lê PA, VET, Recebimento Reentregas PA/VET, NFDs, Ocorrências e Lista de Motoristas. Os recebimentos são casados com os lançamentos de PA/VET (mesma NF, até 7 dias) para completar hora, motorista, valor, conferente e turno. Reimportar **não duplica**.
3. Confira as **listas** (motivos, conferentes, horário dos turnos) e salve.

> Taxa de reentrega = NFs faturadas no mês que voltaram ao menos uma vez ÷ NFs faturadas no mês (pelo consolidado). Ela só aparece para os meses que existem no consolidado carregado. Para ter o 1º semestre, envie também o arquivo do 1º semestre.

## Estrutura

```
api/index.js      API única (login, registros, aprovação, consolidado, importação)
lib/redis.js      conexão Upstash
public/           app (HTML/CSS/JS + bibliotecas de Excel e gráficos locais)
```
