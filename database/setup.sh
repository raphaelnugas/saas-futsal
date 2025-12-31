#!/bin/bash

# Script de Instalação e Configuração - Futsal D'Domingo
# PostgreSQL Database Setup

echo "🚀 Iniciando configuração do banco de dados PostgreSQL..."
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para imprimir mensagens coloridas
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Verificar se o PostgreSQL está instalado
check_postgres() {
    if ! command -v psql &> /dev/null; then
        print_error "PostgreSQL não está instalado!"
        print_info "Por favor, instale o PostgreSQL primeiro:"
        print_info "https://www.postgresql.org/download/windows/"
        exit 1
    fi
    
    print_success "PostgreSQL encontrado!"
}

# Verificar se o serviço está rodando
check_service() {
    if pg_ctl status -D "$PGDATA" 2>/dev/null | grep -q "server is running"; then
        print_success "Serviço PostgreSQL está rodando!"
        return 0
    else
        print_warning "Serviço PostgreSQL não está rodando."
        print_info "Tentando iniciar o serviço..."
        
        # Tentar iniciar o serviço
        if command -v net &> /dev/null; then
            net start postgresql-x64-14 2>/dev/null || true
            net start postgresql-x64-15 2>/dev/null || true
            net start postgresql-x64-16 2>/dev/null || true
        fi
        
        # Verificar novamente
        sleep 3
        if pg_ctl status -D "$PGDATA" 2>/dev/null | grep -q "server is running"; then
            print_success "Serviço PostgreSQL iniciado com sucesso!"
            return 0
        else
            print_error "Não foi possível iniciar o serviço PostgreSQL."
            print_info "Por favor, inicie manualmente o serviço."
            exit 1
        fi
    fi
}

# Criar banco de dados
create_database() {
    print_info "Criando banco de dados 'futsal_domingo'..."
    
    # Tentar criar o banco de dados
    if psql -U postgres -c "CREATE DATABASE futsal_domingo;" 2>/dev/null; then
        print_success "Banco de dados criado com sucesso!"
    else
        # Verificar se já existe
        if psql -U postgres -c "\l" | grep -q "futsal_domingo"; then
            print_warning "Banco de dados já existe."
            read -p "Deseja recriar o banco? (s/n): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Ss]$ ]]; then
                print_info "Dropando banco existente..."
                psql -U postgres -c "DROP DATABASE IF EXISTS futsal_domingo;" 2>/dev/null
                psql -U postgres -c "CREATE DATABASE futsal_domingo;" 2>/dev/null
                print_success "Banco recriado com sucesso!"
            fi
        else
            print_error "Erro ao criar banco de dados."
            exit 1
        fi
    fi
}

# Aplicar schema
apply_schema() {
    print_info "Aplicando schema do banco de dados..."
    
    if [ -f "database/schema.sql" ]; then
        psql -U postgres -d futsal_domingo -f database/schema.sql
        if [ $? -eq 0 ]; then
            print_success "Schema aplicado com sucesso!"
        else
            print_error "Erro ao aplicar schema."
            exit 1
        fi
    else
        print_error "Arquivo database/schema.sql não encontrado!"
        exit 1
    fi
}

# Inserir dados de teste
insert_test_data() {
    print_info "Inserindo dados de teste..."
    
    if [ -f "database/test_data.sql" ]; then
        psql -U postgres -d futsal_domingo -f database/test_data.sql
        if [ $? -eq 0 ]; then
            print_success "Dados de teste inseridos com sucesso!"
        else
            print_warning "Erro ao inserir dados de teste."
        fi
    else
        print_warning "Arquivo database/test_data.sql não encontrado."
    fi
}

# Verificar instalação
verify_installation() {
    print_info "Verificando instalação..."
    
    # Testar conexão
    if psql -U postgres -d futsal_domingo -c "SELECT NOW();" >/dev/null 2>&1; then
        print_success "Conexão com banco de dados estabelecida!"
    else
        print_error "Erro ao conectar ao banco de dados."
        exit 1
    fi
    
    # Verificar tabelas
    tables=$(psql -U postgres -d futsal_domingo -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
    print_info "Tabelas criadas: $tables"
    
    # Listar tabelas
    print_info "Tabelas do banco:"
    psql -U postgres -d futsal_domingo -c "\dt"
}

# Criar arquivo .env
create_env_file() {
    print_info "Criando arquivo .env..."
    
    if [ ! -f ".env" ]; then
        cat > .env << EOF
# Banco de Dados PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=futsal_domingo
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui

# Autenticação JWT
JWT_SECRET=sua_chave_secreta_super_segura_aqui_$(date +%s)
MASTER_PASSWORD_HASH=\$2b\$10\$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

# Servidor
PORT=3001
NODE_ENV=development

# Configurações do Jogo
MATCH_DURATION_MINUTES=10
MAX_PLAYERS_PER_TEAM=5
SESSION_DURATION_MINUTES=120
EOF
        print_success "Arquivo .env criado!"
        print_warning "Por favor, edite o arquivo .env e configure sua senha do PostgreSQL."
    else
        print_warning "Arquivo .env já existe."
    fi
}

# Menu principal
main() {
    echo "=========================================="
    echo "  🏆 FUTSAL D'DOMINGO - CONFIGURAÇÃO"
    echo "=========================================="
    echo
    
    # Verificar PostgreSQL
    check_postgres
    
    # Verificar serviço
    check_service
    
    # Criar banco de dados
    create_database
    
    # Aplicar schema
    apply_schema
    
    # Inserir dados de teste
    read -p "Deseja inserir dados de teste? (s/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        insert_test_data
    fi
    
    # Verificar instalação
    verify_installation
    
    # Criar .env
    create_env_file
    
    echo
    echo "=========================================="
    print_success "CONFIGURAÇÃO CONCLUÍDA! 🎉"
    echo "=========================================="
    echo
    print_info "Próximos passos:"
    echo "1. Configure sua senha do PostgreSQL no arquivo .env"
    echo "2. Instale as dependências: npm install"
    echo "3. Teste a conexão: node database/test-connection.js"
    echo
    print_info "Comandos úteis:"
    echo "- Acessar o banco: psql -U postgres -d futsal_domingo"
    echo "- Ver tabelas: \\dt"
    echo "- Ver ranking: SELECT * FROM player_ranking;"
    echo
}

# Executar o script
main "$@"