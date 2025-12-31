# Script de Setup Completo - Futsal D'Domingo (Windows)
# PowerShell Setup Script

Write-Host "🚀 Iniciando setup completo do Futsal D'Domingo..." -ForegroundColor Blue
Write-Host ""

# Funções para output colorido
function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }

# Verificar Node.js
function Check-Node {
    try {
        $nodeVersion = node --version
        Write-Success "Node.js encontrado: $nodeVersion"
        return $true
    } catch {
        Write-Error "Node.js não encontrado!"
        Write-Info "Por favor, instale o Node.js: https://nodejs.org/"
        return $false
    }
}

# Verificar npm
function Check-Npm {
    try {
        $npmVersion = npm --version
        Write-Success "npm encontrado: $npmVersion"
        return $true
    } catch {
        Write-Error "npm não encontrado!"
        return $false
    }
}

# Instalar dependências
function Install-Dependencies {
    Write-Info "Instalando dependências do projeto..."
    
    # Criar package.json principal se não existir
    if (-not (Test-Path "package.json")) {
        Write-Info "Criando package.json principal..."
        $package = @{
            name = "futsal-domingo"
            version = "1.0.0"
            description = "Sistema de gerenciamento de partidas de futsal aos domingos"
            main = "server.js"
            scripts = @{
                start = "node server.js"
                dev = "nodemon server.js"
                'db:setup' = "node database/setup.js"
                'db:test' = "node database/test-connection.js"
                'db:reset' = "node database/setup.js"
                'db:seed' = "psql -U postgres -d futsal_domingo -f database/test_data.sql"
                'db:backup' = "pg_dump -U postgres -d futsal_domingo > backup_$(Get-Date -Format yyyyMMdd_HHmmss).sql"
                'db:shell' = "psql -U postgres -d futsal_domingo"
            }
            dependencies = @{
                express = "^4.18.2"
                pg = "^8.11.3"
                bcryptjs = "^2.4.3"
                jsonwebtoken = "^9.0.2"
                cors = "^2.8.5"
                dotenv = "^16.3.1"
                'socket.io' = "^4.7.2"
            }
            devDependencies = @{
                nodemon = "^3.0.1"
            }
            keywords = @("futsal","sports","management","nodejs","postgresql")
            author = "Futsal D'Domingo"
            license = "MIT"
        }
        $package | ConvertTo-Json -Depth 6 | Out-File -FilePath "package.json" -Encoding UTF8
        Write-Success "package.json criado!"
    }
    
    # Instalar dependências
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Dependências instaladas com sucesso!"
    } else {
        Write-Error "Erro ao instalar dependências."
        return $false
    }
    return $true
}

# Criar arquivo .env
function Create-EnvFile {
    Write-Info "Criando arquivo .env..."
    
    if (-not (Test-Path ".env")) {
        $timestamp = Get-Date -Format "yyyyMMddHHmmss"
        $envLines = @(
            "# Banco de Dados PostgreSQL",
            "DB_HOST=localhost",
            "DB_PORT=5432",
            "DB_NAME=futsal_domingo",
            "DB_USER=postgres",
            "DB_PASSWORD=sua_senha_aqui",
            "",
            "# Autenticação JWT",
            "JWT_SECRET=sua_chave_secreta_super_segura_aqui_$timestamp",
            "MASTER_PASSWORD_HASH=`$2b`$10`$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi",
            "",
            "# Servidor",
            "PORT=3001",
            "NODE_ENV=development",
            "",
            "# Configurações do Jogo",
            "MATCH_DURATION_MINUTES=10",
            "MAX_PLAYERS_PER_TEAM=5",
            "SESSION_DURATION_MINUTES=120"
        )
        $envLines | Out-File -FilePath ".env" -Encoding UTF8
        Write-Success "Arquivo .env criado!"
        Write-Warning "Por favor, edite o arquivo .env e configure sua senha do PostgreSQL."
    } else {
        Write-Warning "Arquivo .env já existe."
    }
}

# Verificar PostgreSQL
function Check-PostgreSQL {
    try {
        $psqlPath = Get-Command psql -ErrorAction Stop
        Write-Success "PostgreSQL encontrado!"
        return $true
    } catch {
        Write-Error "PostgreSQL não encontrado!"
        Write-Info "Por favor, instale o PostgreSQL: https://www.postgresql.org/download/"
        return $false
    }
}

# Executar setup do banco de dados
function Setup-Database {
    Write-Info "Configurando banco de dados..."
    
    if (Test-Path "database/setup.js") {
        node database/setup.js
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Banco de dados configurado com sucesso!"
            return $true
        } else {
            Write-Error "Erro ao configurar banco de dados."
            Write-Info "Verifique se o PostgreSQL está rodando e a senha está correta."
            return $false
        }
    } else {
        Write-Error "Script de setup não encontrado: database/setup.js"
        return $false
    }
}

# Testar conexão
function Test-Connection {
    Write-Info "Testando conexão com o banco de dados..."
    
    if (Test-Path "database/test-connection.js") {
        node database/test-connection.js
    } else {
        Write-Warning "Script de teste não encontrado."
    }
}

# Função principal
function Main {
    Clear-Host
    Write-Host "==========================================" -ForegroundColor Blue
    Write-Host "  🏆 FUTSAL D'DOMINGO - SETUP COMPLETO" -ForegroundColor Blue
    Write-Host "==========================================" -ForegroundColor Blue
    Write-Host ""
    
    # Verificar Node.js e npm
    if (-not (Check-Node)) {
        return
    }
    if (-not (Check-Npm)) {
        return
    }
    
    # Instalar dependências
    if (-not (Install-Dependencies)) {
        return
    }
    
    # Criar .env
    Create-EnvFile
    
    # Verificar PostgreSQL
    if (Check-PostgreSQL) {
        # Setup do banco de dados
        $setupDb = Read-Host "Deseja configurar o banco de dados agora? (s/n)"
        if ($setupDb -eq 's' -or $setupDb -eq 'S') {
            if (Setup-Database) {
                # Testar conexão
                $testConn = Read-Host "Deseja testar a conexão? (s/n)"
                if ($testConn -eq 's' -or $testConn -eq 'S') {
                    Test-Connection
                }
            }
        }
    }
    
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "🎉 SETUP CONCLUÍDO!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
    Write-Info "Próximos passos:"
    Write-Host "1. Configure sua senha do PostgreSQL no arquivo .env"
    Write-Host "2. Execute: npm run db:setup (para configurar o banco)"
    Write-Host "3. Execute: npm run db:test (para testar a conexão)"
    Write-Host "4. Execute: npm run dev (para iniciar o servidor)"
    Write-Host ""
    Write-Info "Comandos úteis:"
    Write-Host "- npm run db:setup    # Configurar banco de dados"
    Write-Host "- npm run db:test    # Testar conexão"
    Write-Host "- npm run db:seed    # Inserir dados de teste"
    Write-Host "- npm run db:shell   # Acessar console PostgreSQL"
    Write-Host ""
}

# Executar o script
Main