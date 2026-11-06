#!/bin/bash
# =============================================================================
# Script de configuração dos limites do Valhalla
#
# O valhalla.json é gerado automaticamente pelo container na primeira execução
# e está no .gitignore. Este script aplica os limites de serviço necessários
# para a roteirização funcionar corretamente.
#
# CONTEXTO:
# O endpoint /optimized_route calcula uma matriz N×N internamente.
# Com COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS=100 no microserviço,
# o máximo de locations é 102 (100 + origin + destination).
# 102² = 10.404 pares → precisamos de max_matrix_location_pairs >= 10.404
# Usamos 12.000 para margem de segurança.
#
# USO:
#   ./scripts/configure_valhalla_limits.sh
#
# NOTA: Requer que o container valhalla esteja rodando.
# Após executar, reinicie o container: docker compose restart valhalla
# =============================================================================

set -e

CONTAINER_CONFIG="/custom_files/valhalla.json"

# --- Pré-condições ---

# Verifica se o container está rodando
if ! docker compose ps --status running 2>/dev/null | grep -q valhalla; then
    echo "❌ Container 'valhalla' não está rodando."
    echo "   Execute 'docker compose up -d valhalla' primeiro."
    exit 1
fi

# Verifica se o arquivo de config existe dentro do container
if ! docker compose exec -T valhalla test -f "$CONTAINER_CONFIG" 2>/dev/null; then
    echo "❌ Arquivo $CONTAINER_CONFIG não encontrado no container."
    echo "   O container precisa ter completado o build inicial dos tiles."
    exit 1
fi

# --- Aplicação dos limites ---

echo "📝 Aplicando limites de serviço ao Valhalla..."

docker compose exec -T --user root valhalla python3 -c "
import json, sys

config_path = '${CONTAINER_CONFIG}'

with open(config_path, 'r') as f:
    config = json.load(f)

# Costings que o sistema de roteirização utiliza:
# - auto: usado por computeRoutes (/optimized_route) e computeDistanceMatrix
# - bus: usado por validateRouteRestriction (/route)
# - truck: fallback para veículos pesados
costings_to_update = ['auto', 'bus', 'truck']

# Limites alinhados com COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS = 100
# max_locations = 110 (para /route, com margem)
# max_matrix_location_pairs = 12000 (para /optimized_route, 102² = 10404 < 12000)
REQUIRED_MAX_LOCATIONS = 110
REQUIRED_MAX_MATRIX_PAIRS = 12000

changes = []
already_ok = []

for costing in costings_to_update:
    if costing not in config.get('service_limits', {}):
        print(f'⚠️  Costing \"{costing}\" não encontrado em service_limits. Ignorando.')
        continue

    limits = config['service_limits'][costing]
    old_loc = limits.get('max_locations', 0)
    old_pairs = limits.get('max_matrix_location_pairs', 0)

    if old_loc == REQUIRED_MAX_LOCATIONS and old_pairs == REQUIRED_MAX_MATRIX_PAIRS:
        already_ok.append(costing)
        continue

    limits['max_locations'] = REQUIRED_MAX_LOCATIONS
    limits['max_matrix_location_pairs'] = REQUIRED_MAX_MATRIX_PAIRS

    changes.append(f'  {costing}: max_locations {old_loc} -> {REQUIRED_MAX_LOCATIONS}, '
                   f'max_matrix_location_pairs {old_pairs} -> {REQUIRED_MAX_MATRIX_PAIRS}')

if not changes and already_ok:
    print(f'✅ Limites já estão corretos para: {', '.join(already_ok)}')
    print('   Nenhuma alteração necessária.')
    sys.exit(0)

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')

if changes:
    print('✅ Limites atualizados:')
    for change in changes:
        print(change)

if already_ok:
    print(f'ℹ️  Já corretos: {', '.join(already_ok)}')
"

echo ""
echo "⚠️  Reinicie o container para aplicar: docker compose restart valhalla"
