Microservice for testing route computation with Valhalla. Collects location data from generic IoT devices, feeds it into the routing engine, and validates the generated routes, ETAs and map-matching results.

# track Router

## setup

```bash
# yarn
yarn
```
### Inicia em modo dev

```bash
# yarn
yarn dev
```

### Gera build de produção

```bash
# yarn
yarn build:prod
```

## Documentação

### Diagrama

[Draw.io](https://drive.google.com/file/d/1dMEKLhgd4EIgX6RzkVztt7DDi5VJP4p4/view)

### Padrões utilizados no projeto

#### Validações de body

// TODO

#### Services

##### ChunkSchoolService

Service responsavel por agrupar as escolas em grupos por proximidade. Recebe como parametro um array de escolas (e suas localizações) e as configurações da roteirização, sendo entre as configurações a unica relevante a `schoolMaxDistance` e retorna um array de chunks sendo que cada chunk é um array de escolas com distância máxima entre si menor que a da config `schoolMaxDistance`. O serviço primeiro identifica se todas as escolas já estão próximas o suficiente pelo método `areSchoolsInChunkCloseBy`, se for o caso ele retorna apenas uma chunk com todas as escolas, caso contrario é utilizado o [algoritmo kmeans](https://medium.com/cwi-software/entendendo-clusters-e-k-means-56b79352b452) com um numero fixo de grupos a serem identificados (inicialmente 2, pela variavel `clustersNumber`). Após a clusterização é verificado cada cluster se ele passa na verificação do método `areSchoolsInChunkCloseBy`, caso algum dos clusteres passe, ele é adicionado no array `doneClusters` que posteriormente irão para o array final de chunks que será retornado pelo serviço. As escolas dos chunks que não passarem a validação são adicionadas ao array `remainingSchools` para serem clusterizadas novamente.

Esse processo é repetido até que todas as escolas estejam em um chunk que passe a condição (mesmo que isso signifique que a escola esteja num chunk sozinha). A cada iteração, o numero de clusteres é aumentado em 1 e reduzido pela quantidade de chunks encontrados (esse valor é subtraido para que não haja possiveis chunks pulados)

// TODO

#### Types e interfaces

// TODO

#### Lançamento de excessões

Neste projeto, quando um método ou fluxo é feito com algum dado inválido ou de forma errada (por exemplo: o typescript acusa que uma variável pode estar undefined, mas para o aquele contexto ela deveria estar) é recomendavel ser lançada uma excessão.
Ex:
```ts
if (!this.updatedDuration) throw new Error('`updatedDuration` was not defined');
```

### Objeto de Config

// TODO

### Calculate Routes

// TODO

### Recalculate Routes

Essa rota chama o serviço `RecalculateLineService` que vai recalcular os tempos e as distâncias de uma linha com base na linha original. Uma linha é composta de até 3 rotas, rota do estudante, rota entre escolas e rota da garagem (não implementada).

Para cada rota da linha o sitema irá chamar o serviço `RecalculateRoutePolylineService` que executa os seguintes passos:
- Verifica modificações na liha (quais pontos foram adicionados e removidos) usando o método `polylineDiff`;
- Calcula a distância usando o método `lineDistance` dos trexos adicionados e soma o valor à distância original;
- Calcula a distância usando o método `lineDistance` dos trexos removidos e subtrai o valor à distância original;
- Calcula a velocidade média da rota original e usa essa velocidade para recalcular a duração da nova rota.

Feito isso, será recalculado o tempo e a distância total da linha somando os valores das rotas. Na somatória da duração da linha, é adicionado o tempo que o veículo fica ocioso.

### Data

São métodos de manipulação de dados que não tem regra de negócio envolvida. Separados em arquivos de acordo com o tipo de dado a ser manipulado.

#### Coordinates

// TODO

#### Chunk

// TODO

#### Array

// TODO

#### Polyline

Uma polyline é uma sequência de coordenadas de uma linha conectados, utilizada para representar trajetos ou formas, como linhas retas que ligam pontos em um mapa.

- **polylineDiff**: Recebe duas Polylines a original e uma modificação dela, então percorre por cada coordenada delas comparando os valores para identificar trexos de adição e remoção. Funciona de forma similar ao que o gitlab e github fazem nas diffs dos MRs/PRs. Quando uma diferença é encontrada, junto com o trexo modificado é adicionado um ponto antes e um depois da modificação de fato (pois a distância do ponto anterior até o primeiro ponto modificado é relevante e o mesmo vale para a distância do ultimo ponto motificado até o ponto seguinte).

- **lineDistance**: Calcula a distância percorrida em uma polyline levando em consideração a curvatura da terra, utiliza o método `calculateAbsoluteDistance`.
