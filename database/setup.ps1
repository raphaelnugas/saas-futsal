# Script de Instalação e Configuração - Futsal D'Domingo (Windows)
# PostgreSQL Database Setup para PowerShell

Write-Host "🚀 Iniciando configuração do banco de dados PostgreSQL..." -ForegroundColor Blue
Write-Host ""

# Funções para output colorido
function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }

# Verificar se o PostgreSQL está instalado
function Check-PostgreSQL {
    try {
        $psqlPath = Get-Command psql -ErrorAction Stop
        Write-Success "PostgreSQL encontrado!"
        return $true
    } catch {
        Write-Error "PostgreSQL não está instalado ou não está no PATH!"
        Write-Info "Por favor, instale o PostgreSQL primeiro:"
        Write-Info "https://www.postgresql.org/download/windows/"
        return $false
    }
}

# Verificar se o serviço está rodando
function Check-Service {
    $services = @('postgresql-x64-16', 'postgresql-x64-15', 'postgresql-x64-14', 'postgresql-x64-13')
    $runningService = $null
    
    foreach ($service in $services) {
        $serviceObj = Get-Service -Name $service -ErrorAction SilentlyContinue
        if ($serviceObj -and $serviceObj.Status -eq 'Running') {
            $runningService = $service
            break
        }
    }
    
    if ($runningService) {
        Write-Success "Serviço PostgreSQL está rodando! ($runningService)"
        return $true
    } else {
        Write-Warning "Serviço PostgreSQL não está rodando."
        Write-Info "Tentando iniciar o serviço..."
        
        foreach ($service in $services) {
            try {
                Start-Service -Name $service -ErrorAction Stop
                Write-Success "Serviço $service iniciado com sucesso!"
                Start-Sleep -Seconds 3
                return $true
            } catch {
                continue
            }
        }
        
        Write-Error "Não foi possível iniciar o serviço PostgreSQL."
        return $false
    }
}

# Criar banco de dados
function Create-Database {
    Write-Info "Criando banco de dados 'futsal_domingo'..."
    
    try {
        # Tentar criar o banco de dados
        & psql -U postgres -c "CREATE DATABASE futsal_domingo;" 2>$null
        Write-Success "Banco de dados criado com sucesso!"
    } catch {
        # Verificar se já existe
        $databases = & psql -U postgres -t -c "\l" 2>$null
        if ($databases -match "futsal_domingo") {
            Write-Warning "Banco de dados já existe."
            $recreate = Read-Host "Deseja recriar o banco? (s/n)"
            if ($recreate -eq 's' -or $recreate -eq 'S') {
                Write-Info "Dropando banco existente..."
                & psql -U postgres -c "DROP DATABASE IF EXISTS futsal_domingo;" 2>$null
                & psql -U postgres -c "CREATE DATABASE futsal_domingo;" 2>$null
                Write-Success "Banco recriado com sucesso!"
            }
        } else {
            Write-Error "Erro ao criar banco de dados: $_"
            return $false
        }
    }
    return $true
}

# Aplicar schema
function Apply-Schema {
    Write-Info "Aplicando schema do banco de dados..."
    
    if (Test-Path "database\schema.sql") {
        try {
            & psql -U postgres -d futsal_domingo -f database\schema.sql
            Write-Success "Schema aplicado com sucesso!"
            return $true
        } catch {
            Write-Error "Erro ao aplicar schema: $_"
            return $false
        }
    } else {
        Write-Error "Arquivo database\schema.sql não encontrado!"
        return $false
    }
}

# Inserir dados de teste
function Insert-TestData {
    Write-Info "Inserindo dados de teste..."
    
    if (Test-Path "database\test_data.sql") {
        try {
            & psql -U postgres -d futsal_domingo -f database\test_data.sql
            Write-Success "Dados de teste inseridos com sucesso!"
        } catch {
            Write-Warning "Erro ao inserir dados de teste: $_"
        }
    } else {
        Write-Warning "Arquivo database\test_data.sql não encontrado."
    }
}

# Verificar instalação
function Verify-Installation {
    Write-Info "Verificando instalação..."
    
    # Testar conexão
    try {
        $result = & psql -U postgres -d futsal_domingo -c "SELECT NOW();" 2>$null
        Write-Success "Conexão com banco de dados estabelecida!"
    } catch {
        Write-Error "Erro ao conectar ao banco de dados: $_"
        return $false
    }
    
    # Verificar tabelas
    try {
        $tables = & psql -U postgres -d futsal_domingo -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>$null
        Write-Info "Tabelas criadas: $($tables.Trim())"
        
        # Listar tabelas
        Write-Info "Tabelas do banco:"
        & psql -U postgres -d futsal_domingo -c "\dt" 2>$null
    } catch {
        Write-Warning "Erro ao verificar tabelas: $_"
    }
    
    return $true
}

# Criar arquivo .env
function Create-EnvFile {
    Write-Info "Criando arquivo .env..."
    
    if (-not (Test-Path ".env")) {
        $envContent = @"
# Banco de Dados PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=futsal_domingo
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui

# Autenticação JWT
JWT_SECRET=sua_chave_secreta_super_segura_aqui_$(Get-Date -Format yyyyMMddHHmmss)
MASTER_PASSWORD_HASH=`$2b`$10`$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

# Servidor
PORT=3001
NODE_ENV=development

# Configurações do Jogo
MATCH_DURATION_MINUTES=10
MAX_PLAYERS_PER_TEAM=5
SESSION_DURATION_MINUTES=120
"@
        
        $envContent | Out-File -FilePath ".env" -Encoding UTF8
        Write-Success "Arquivo .env criado!"
        Write-Warning "Por favor, edite o arquivo .env e configure sua senha do PostgreSQL."
    } else {
        Write-Warning "Arquivo .env já existe."
    }
}

# Função principal
function Main {
    Clear-Host
    Write-Host "==========================================" -ForegroundColor Blue
    Write-Host "  🏆 FUTSAL D'DOMINGO - CONFIGURAÇÃO" -ForegroundColor Blue
    Write-Host "==========================================" -ForegroundColor Blue
    Write-Host ""
    
    # Verificar PostgreSQL
    if (-not (Check-PostgreSQL)) {
        return
    }
    
    # Verificar serviço
    if (-not (Check-Service)) {
        return
    }
    
    # Criar banco de dados
    if (-not (Create-Database)) {
        return
    }
    
    # Aplicar schema
    if (-not (Apply-Schema)) {
        return
    }
    
    # Inserir dados de teste
    $insertData = Read-Host "Deseja inserir dados de teste? (s/n)"
    if ($insertData -eq 's' -or $insertData -eq 'S') {
        Insert-TestData
    }
    
    # Verificar instalação
    if (-not (Verify-Installation)) {
        return
    }
    
    # Criar .env
    Create-EnvFile
    
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "🎉 CONFIGURAÇÃO CONCLUÍDA!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
    Write-Info "Próximos passos:"
    Write-Host "1. Configure sua senha do PostgreSQL no arquivo .env"
    Write-Host "2. Instale as dependências: npm install"
    Write-Host "3. Teste a conexão: node database/test-connection.js"
    Write-Host ""
    Write-Info "Comandos úteis:"
    Write-Host "- Acessar o banco: psql -U postgres -d futsal_domingo"
    Write-Host "- Ver tabelas: \\dt"
    Write-Host "- Ver ranking: SELECT * FROM player_ranking;"
    Write-Host ""
}

# Executar o script
Main