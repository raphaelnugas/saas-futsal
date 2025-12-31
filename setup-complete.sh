#!/bin/bash

# Script de Setup Completo - Futsal D'Domingo
# Instala dependências e configura o banco de dados

echo "🚀 Iniciando setup completo do Futsal D'Domingo..."
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Verificar Node.js
check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_success "Node.js encontrado: $NODE_VERSION"
        return 0
    else
        print_error "Node.js não encontrado!"
        print_info "Por favor, instale o Node.js: https://nodejs.org/"
        exit 1
    fi
}

# Verificar npm
check_npm() {
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        print_success "npm encontrado: $NPM_VERSION"
        return 0
    else
        print_error "npm não encontrado!"
        exit 1
    fi
}

# Instalar dependências do projeto
install_dependencies() {
    print_info "Instalando dependências do projeto..."
    
    # Criar package.json principal se não existir
    if [ ! -f "package.json" ]; then
        print_info "Criando package.json principal..."
        cat > package.json << 'EOF'
{
  "name": "futsal-domingo",
  "version": "1.0.0",
  "description": "Sistema de gerenciamento de partidas de futsal aos domingos",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "db:setup": "node database/setup.js",
    "db:test": "node database/test-connection.js",
    "db:reset": "node database/setup.js",
    "db:seed": "psql -U postgres -d futsal_domingo -f database/test_data.sql",
    "db:backup": "pg_dump -U postgres -d futsal_domingo > backup_$(date +%Y%m%d_%H%M%S).sql",
    "db:shell": "psql -U postgres -d futsal_domingo"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "socket.io": "^4.7.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "keywords": [
    "futsal",
    "sports",
    "management",
    "nodejs",
    "postgresql"
  ],
  "author": "Futsal D'Domingo",
  "license": "MIT"
}
EOF
        print_success "package.json criado!"
    fi
    
    # Instalar dependências
    npm install
    if [ $? -eq 0 ]; then
        print_success "Dependências instaladas com sucesso!"
    else
        print_error "Erro ao instalar dependências."
        exit 1
    fi
}

# Criar arquivo .env
create_env_file() {
    print_info "Criando arquivo .env..."
    
    if [ ! -f ".env" ]; then
        cat > .env << 'EOF'
# Banco de Dados PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=futsal_domingo
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui

# Autenticação JWT
JWT_SECRET=sua_chave_secreta_super_segura_aqui_$(date +%s)
MASTER_PASSWORD_HASH=$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

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

# Verificar PostgreSQL
check_postgres() {
    if command -v psql &> /dev/null; then
        print_success "PostgreSQL encontrado!"
        return 0
    else
        print_error "PostgreSQL não encontrado!"
        print_info "Por favor, instale o PostgreSQL: https://www.postgresql.org/download/"
        return 1
    fi
}

# Executar setup do banco de dados
setup_database() {
    print_info "Configurando banco de dados..."
    
    if [ -f "database/setup.js" ]; then
        node database/setup.js
        if [ $? -eq 0 ]; then
            print_success "Banco de dados configurado com sucesso!"
        else
            print_error "Erro ao configurar banco de dados."
            print_info "Verifique se o PostgreSQL está rodando e a senha está correta."
            return 1
        fi
    else
        print_error "Script de setup não encontrado: database/setup.js"
        return 1
    fi
}

# Testar conexão
test_connection() {
    print_info "Testando conexão com o banco de dados..."
    
    if [ -f "database/test-connection.js" ]; then
        node database/test-connection.js
    else
        print_warning "Script de teste não encontrado."
    fi
}

# Menu principal
main() {
    echo "=========================================="
    echo "  🏆 FUTSAL D'DOMINGO - SETUP COMPLETO"
    echo "=========================================="
    echo
    
    # Verificar Node.js e npm
    check_node
    check_npm
    
    # Instalar dependências
    install_dependencies
    
    # Criar .env
    create_env_file
    
    # Verificar PostgreSQL
    if check_postgres; then
        # Setup do banco de dados
        read -p "Deseja configurar o banco de dados agora? (s/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Ss]$ ]]; then
            setup_database
            
            # Testar conexão
            read -p "Deseja testar a conexão? (s/n): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Ss]$ ]]; then
                test_connection
            fi
        fi
    fi
    
    echo
    echo "=========================================="
    print_success "SETUP CONCLUÍDO! 🎉"
    echo "=========================================="
    echo
    print_info "Próximos passos:"
    echo "1. Configure sua senha do PostgreSQL no arquivo .env"
    echo "2. Execute: npm run db:setup (para configurar o banco)"
    echo "3. Execute: npm run db:test (para testar a conexão)"
    echo "4. Execute: npm run dev (para iniciar o servidor)"
    echo
    print_info "Comandos úteis:"
    echo "- npm run db:setup    # Configurar banco de dados"
    echo "- npm run db:test    # Testar conexão"
    echo "- npm run db:seed    # Inserir dados de teste"
    echo "- npm run db:shell   # Acessar console PostgreSQL"
    echo
}

# Executar o script
main "$@"