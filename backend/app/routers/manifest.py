from fastapi import APIRouter, Request

from app.schemas import Manifest

router = APIRouter()


@router.get("/manifest", response_model=Manifest)
def get_manifest(request: Request) -> Manifest:
    return request.app.state.manifest
