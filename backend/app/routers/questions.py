from fastapi import APIRouter, Request

from app.data import DEFAULT_FIELD
from app.schemas import QuestionSet

router = APIRouter()


@router.get("/questions/{field}", response_model=QuestionSet)
def get_questions(field: str, request: Request) -> QuestionSet:
    sets: dict[str, QuestionSet] = request.app.state.question_sets
    return sets.get(field.lower(), sets[DEFAULT_FIELD])
