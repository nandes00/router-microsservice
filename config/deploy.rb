require 'mina/bundler'
require 'mina/deploy'
require 'mina/rails'
require 'mina/git'
require 'mina/rvm'
 
set :repository, ENV.fetch('REPOSITORY_URL')
set :application_name, 'track'
set :user, ENV.fetch('SERVER_USER', 'ubuntu')
set :branch, ENV.fetch('BRANCH')
set :rails_env, ENV.fetch('RAILS_ENV')
set :domain, ENV.fetch('SERVER_HOST')
set :deploy_to, ENV.fetch('DEPLOY_PATH')
set :docker_compose, "#{fetch(:deploy_to)}#{ENV.fetch('DOCKER_COMPOSE_FILE')}"
 
task :remote_environment do
end
 
desc 'Deploys the current version to the server.'
task :deploy_docker do
  command %[cd #{fetch(:deploy_to)} && GIT_SSH_COMMAND='ssh -i ~/.ssh/juno.pem' git pull origin "#{fetch(:branch)}"]
  command %[docker compose -f #{fetch(:docker_compose)} up --build --detach]
  # command %[docker exec track-api bundle exec rails db:migrate]
end
