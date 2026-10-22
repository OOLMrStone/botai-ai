# ЮKassa: подписка и разовый пакет, test-only

2026-10-08. **V14 реализован; provider E2E и результаты — в runtime notes.** Root подтвердил готовность test shop/ключей/уведомлений и read-only `/me`: test=true, enabled. Только отдельная `*_payments_test` БД, allowlisted verified accounts и mock AI без live credentials; production/users.plan_id не меняются.

## Продукт и совместимость

| Тариф | Подписка: 30 суток | Сезон: разовый большой пакет |
| --- | --- | --- |
| light | 299 RUB / 30 проверок | 1499 RUB / 240 проверок |
| core | 699 RUB / 70 проверок | 3499 RUB / 560 проверок |
| heavy | 899 RUB / 110 проверок | 4999 RUB / 880 проверок |

Факты из frontend `storefront-pricing.ts`/`legal-offer.ts`: 30×24 часа; цена подписки фиксируется при согласии; новая полная квота каждого оплаченного периода, без переноса. Сезон предоставляется целиком до `2027-06-10T21:00:00Z` исключительно. Формула уменьшения сезонной цены/квоты не согласована: пока существующие фиксированные test fixtures. Это требования продукта, не проверка договора ЮKassa.

Root принял: подписка **или** сезон, без overlap/top-up/upgrade/re-enable/перерасчёта; следующая покупка после оплаченного срока и разрешения unresolved. Новые месячные ID `light/core/heavy-month-subscription-v1`; сезонные `*-season-v1` стабильны. Старые `*-month-v1` остаются разовой историей/resume существующей операции; её payload/цена/смысл неизменны.

## Платёжная модель

- Перед каждым POST — `/me`: test=true, account_id совпадает, status=enabled. Success подтверждается отдельным GET payment: test/recipient/id/metadata/amount/RUB; право только при succeeded+paid. Immutable request JSON/offer/provider UUID key сохраняются до HTTP, HTTP вне transaction. Timeout/500 повторяет ту же операцию до 23ч; verified canceled — окончательный decline без автоматической новой попытки; поздний unknown → review_required, слот остаётся занят. [API](https://yookassa.ru/developers/using-api/interaction-format).
- Initial subscription: отдельный unchecked consent, server version/text hash/time/price/30d/cancel terms; затем `save_payment_method:true`. Verified paid всегда выдаёт период. Auto включается только при saved=true и проверенном method ID; saved=false даёт оплаченный доступ, auto off, actionRequired=payment_method_required. ID только server-side, привязан к user/shop/subscription; нет клиентского ID/PAN/CVC/токена в DTO/логах. One-off метод не запрашивает и не сохраняет. [Привязка](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/save-payment-method/save-during-payment).
- Renewal: новый payment/key с `payment_method_id`, capture=true. Scheduler наш; provider DELETE метода не предполагается, отключение локальное. [Автоплатежи](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/basics), [списание](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/pay-with-saved).

V14: subscriptions (immutable offer/consent + state/renewalEnabled/revokedAt/nextDueAt/revision/private method); periods (`UNIQUE(subscription_id,sequence)`, `UNIQUE(payment_id)`, максимум один grant); usage_settlements (`submission_id` PK, append-only consume/release/reason/time). V13 payment/payload/grants не переписываются. Subscription states: pending_initial/active/payment_failed/canceled/review_required. State и paid access независимы: canceled/payment_failed могут ещё иметь оплаченный срок.

Первый grant начинается при выдаче. Worker инициирует следующий при now≥currentPeriod.expiresAt; новый startsAt=max(previous.expiresAt,verifiedGrantTime), expiresAt=startsAt+30d. Нет неоплаченного grace/catch-up серии за пропущенные месяцы. Новый период = отдельный grant/квота. Все действия: user→subscription→period/payment; uniqueness и lease/fencing защищают от duplicate/restart/двух workers. Renewal decline выключает auto; возобновление — новая явная покупка, когда разрешено.

**Cancel boundary:** отмена под теми же locks отзывает consent и запрещает новую dispatch-авторизацию. Durable dispatching — начало уже инициированной операции; последующая отмена возвращает inFlightPaymentId и не обещает её остановить. Каждая попытка POST (включая same-key retry) получает отдельную durable authorization под locks с проверкой актуальных consent/revision/lease fence; cancel до неё запрещает POST, после неё может пересечь только уже авторизованную отправку. После cancel никаких повторных POST: известный ID → GET-only, неизвестный → review_required. Late success сохраняет оплаченный период, auto не включает. Уже оплаченные текущие/будущие периоды сохраняются; paidThrough учитывает оба.

## Единая sandbox-квота

Root одобрил замену V13 queued-charge на reserve→consume/release для месяца и сезона. Queued атомарно reserve 1 вместе с job/event; available=total−reserved−consumed. Valid persisted graded result → consume (0 баллов тоже результат). Unsupported до очереди не резервирует; окончательные rejected/unreadable без результата освобождают. Преддиспетчерская ошибка/отмена освобождает сразу. После dispatch/unknown резерв держится до durable no_result_finalized: job закрыт, retry запрещён, fencing исключает позднее принятие; затем release ровно один раз. Finalizer в одной transaction блокирует reservation/submission/job: нет принятого graded result, terminal no-result, job done без lease/retry, все grading_runs sealed; stale completion не может сохранить result после release. Requeue до dispatch сохраняет резерв.

V13 usage остаётся immutable reservation; единственный settlement исключает двойной возврат/consume после release. Backfill: consume подтверждённым graded, release только доказанно окончательным no-result, uncertain dispatched остаются reserved. Результат после expiry относится к исходному периоду. Технический лимит 30 queued/24h не возвращается при release. Legacy production Pro не меняется.

## Единый API V14

Prefix `/api/billing`; SESSION+CSRF на mutations, owner-only, чужой/нет →404. Исключение — точный POST `/yookassa/test/webhook`: известный provider ID либо metadata.botai_order_id как locator ранее dispatch-authorized known unbound order. Только GET candidate ID, full test/shop/order/amount/status validation; binding+grant атомарны под lease/fence. Unknown/invalid/disallowed/never-dispatched →0 outbound; busy/stale без durable binding →503 для retry, metadata никогда не подтверждает оплату. Прежние bounds/rate limits сохраняются. Confirmation: HTTPS, exact yoomoney.ru/yookassa.ru, без credentials, port absent/443; новые redirect payload имеют locale=ru_RU. Return `/billing/return?paymentId=<local UUID>` ничего не подтверждает.

| API | Контракт |
| --- | --- |
| GET /offers | `{mode:disabled|test,testOnly:true,offers:Offer[]}`; disallowed →disabled/пусто. Offer: `{id,kind:one_time|subscription,plan,period,amount,checkLimit,durationDays?,expiresAt?,autoRenew,intervalDays?,consentVersion?}`. Subscription: durationDays=intervalDays=30, autoRenew=true, consentVersion=test-recurring-v1. |
| POST /payments | Idempotency-Key + `{offerId}`; season one-off или resume legacy operation. Subscription offer отклоняется. Ответ Payment. |
| GET /payments/{id}; POST /payments/{id}/refresh | Local read; bounded provider reconciliation. Прежние semantics. |
| POST /subscriptions | Idempotency-Key + `{offerId,consent:{accepted:true,version}}` →`{subscription,payment}`. Клиент не задаёт price/interval/quota/method ID. |
| GET /subscriptions/{id}; POST /subscriptions/{id}/cancel | Subscription владельца; идемпотентное отключение будущих списаний, inFlightPaymentId при начатой операции. |
| GET /status | `{mode,testOnly:true,entitlement?,canPurchase,currentPaymentId?,subscription?}`; resume без storage, canPurchase учитывает subscription/paid current+future grants/unresolved; subscription относится к последней покупке, после нового season прежняя подписка не подмешивается. |

Payment: прежние `{id,offerId,offer,status,amount,test:true,confirmationUrl?,entitlementApplied,createdAt,cancellationReason?}` + `purpose:one_time|subscription_initial|subscription_renewal`, subscriptionId?, periodSequence?. Status: creating/pending/waiting_for_capture/succeeded/canceled/review_required; offer — immutable snapshot; amount=`{value,currency}`.

Subscription: `{id,status,renewalEnabled,offer,currentPeriod?,nextPaymentAt?,paidThrough?,currentPaymentId?,inFlightPaymentId?,actionRequired?}`. CurrentPeriod: `{sequence,startsAt,expiresAt,checksTotal,checksUsed,checksReserved,checksRemaining}`; entitlement сохраняет V13 поля +checksReserved. Used=consumed, remaining серверный. nextPaymentAt=null при auto off; клиент даты не вычисляет. Все recurring суммы равны initial offer.amount.

Нет consent →400 recurring_consent_required; stale version новой операции →409 recurring_consent_changed. Same-key resume сверяет исходную сохранённую версию; несовпадение →idempotency_conflict. payment_method_required — причина auto off, не ошибка успешной оплаты. Сохраняются billing_unavailable403, billing_purchase_unavailable/idempotency_conflict409, billing_provider_unavailable503, billing_verification_failed502, billing_sandbox_required403, billing_quota_exhausted429. Публичных renew-now/force-charge/clock/method-ID endpoint нет.

## Проверка и оставшиеся границы

- Root одобрил private QA CLI: явно выбранный fixture/subscription, тот же renewal path и `/me` gate; один ранний test renewal. Его grant начинается после текущего, текущая квота не меняется. One-use QA сохраняется в БД; nextDueAt переносится на последний paidThrough, на границе активируется уже оплаченный grant без нового платежа. Реальное продление и его отказ подтверждены [завершённым runtime E2E](YOOKASSA-RUNTIME.md); обычный 30d scheduler/rollover — controlled-clock integration. CLI не меняет часы/срок старого grant и не создаёт HTTP backdoor.
- Реальный E2E завершён: Core initial→renewal→cancel, Light initial при backend outage→renewal decline, Heavy one-off без сохранения method; 5 операций, 4 success, 1 decline, 4 grants. Новый вход восстанавливает доступ. Только [официальные тестовые карты](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing).
- Автотесты: saved=false initial subscription/ownership/reserve→consume→release; concurrent workers/cancel before+after dispatch/late success; unknown/restart/23h; consent/price tampering; duplicate success без quota reset; no carryover/delayed grading; settlement races; V13→V14 backfill; disabled/production isolation.
- Закрытый UI/new session/20 дней отсутствия не мешают фоновому credit: known provider ID проверяется GET без 23h cutoff. Unknown create replay ограничен 23ч; поздний verified callback восстанавливает ID через GET без POST. Полный outage дольше [24ч повторов уведомлений ЮKassa](https://yookassa.ru/developers/using-api/webhooks) при так и не сохранённом provider ID требует ручного разбора: автокредит без проверяемого ID не обещаем, повторный charge запрещён. Restart/20d проверены controlled-clock PostgreSQL tests, не ожиданием 20 дней в реальном времени.
- **V13 baseline:** Java21 122 tests: 120 passed, 2 прежних S3 skipped; независимый security PASS. **V14 + adversarial recovery Java21: 152 tests, 150 passed, 2 прежних S3 skipped, 0 failures/errors**. Реальный provider E2E отдельно: [YOOKASSA-RUNTIME.md](YOOKASSA-RUNTIME.md).
- Design gate PASS: cancel authorization каждого POST, atomic sealed no-result finalizer, persisted one-use QA/paidThrough приняты. [Финальный бриф](BILLING-TEST-BRIEF.md) отдельно перечисляет неподключённые сценарии: seasonal price aging, чеки/возвраты, смена карты, overlap/upgrade/re-enable, production billing. Наличие frontend текста не доказывает реализацию.
