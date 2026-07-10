# Backend module boundaries

Each module owns its application, domain and infrastructure code. Cross-module calls use explicit public contracts; durable side effects use outbox events. No module may query another module's tables as an implicit API. Business modules are activated in backlog order.
