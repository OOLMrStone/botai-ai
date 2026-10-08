"""Correlation-only security diagnostics; backend owns identities and photos."""
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class InternalReportSink:
    run_id: str
    solution_image_ids: list[str] = field(default_factory=list)
    rejection_code: str | None = None
    _attack_recorded: bool = False

    async def record(self, reason: str):
        self.rejection_code = reason
        if reason == 'attack' and not self._attack_recorded:
            logger.warning('Suspicious grading submission', extra={
                'run_id': self.run_id, 'solution_image_ids': list(self.solution_image_ids),
                'reason': reason,
            })
            self._attack_recorded = True
